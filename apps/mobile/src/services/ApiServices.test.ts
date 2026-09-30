/**
 * API repository tests (Phase 1C): authenticated client attaches Bearer JWT and
 * fails closed without a session; API services map to nested course/lesson
 * routes and never send an ownerId as authorization.
 */
import { createApiClient, NotAuthenticatedError } from "./apiClient";
import { ApiCourseService, ApiLessonService, ApiProfileService } from "./ApiServices";

describe("createApiClient", () => {
  const mockFetch = jest.fn();
  beforeEach(() => {
    (global as any).fetch = mockFetch;
    mockFetch.mockReset();
  });

  it("attaches Bearer token and does not send ownerId", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ courses: [] }) });
    const api = createApiClient("https://api.example.com", async () => "jwt-xyz");
    await new ApiCourseService(api).list("ignored-local-userid");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/courses");
    expect(init.headers.Authorization).toBe("Bearer jwt-xyz");
    // No body carrying ownerId on a GET.
    expect(init.body).toBeUndefined();
  });

  it("fails closed with NotAuthenticatedError when no session (no request sent)", async () => {
    const api = createApiClient("https://api.example.com", async () => null);
    await expect(new ApiProfileService(api).get("u")).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("create course posts title only (server derives owner)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ courseId: "course_1", title: "Fizik", createdAt: "t" }),
    });
    const api = createApiClient("https://api.example.com", async () => "jwt");
    const c = await new ApiCourseService(api).create("ignored", "Fizik");
    expect(c.id).toBe("course_1");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ title: "Fizik", color: undefined });
    expect(body).not.toHaveProperty("ownerId");
    expect(body).not.toHaveProperty("userId");
  });

  it("lesson ops use the nested course route", async () => {
    const api = createApiClient("https://api.example.com", async () => "jwt");
    const courses = new ApiCourseService(api);
    const lessons = new ApiLessonService(api, courses);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ lessonId: "lesson_1", courseId: "course_1", title: "Türev", status: "draft", createdAt: "t" }),
    });
    const created = await lessons.create("course_1", "ignored", "Türev");
    expect(created.id).toBe("lesson_1");
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.example.com/courses/course_1/lessons");

    // get() uses the remembered course association + nested route.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ lessonId: "lesson_1", courseId: "course_1", title: "Türev", status: "ready", createdAt: "t" }),
    });
    const got = await lessons.get("lesson_1");
    expect(got?.status).toBe("ready");
    expect(mockFetch.mock.calls[1][0]).toBe("https://api.example.com/courses/course_1/lessons/lesson_1");
  });

  it("surfaces backend error status without masquerading as success", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: "not_found", message: "Ders bulunamadı." } }),
    });
    const api = createApiClient("https://api.example.com", async () => "jwt");
    await expect(new ApiCourseService(api).get("course_x")).resolves.toBeNull();
  });
});
