/**
 * API repository tests (Phase 1C): authenticated client attaches Bearer JWT and
 * fails closed without a session; API services map to nested course/lesson
 * routes and never send an ownerId as authorization.
 */
import { createApiClient, NotAuthenticatedError } from "./apiClient";
import {
  ApiCourseService,
  ApiLessonService,
  ApiProfileService,
  ApiTranscriptService,
  selectLessonTranscriptText,
} from "./ApiServices";

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

describe("ApiTranscriptService (server-persisted lesson transcripts)", () => {
  const mockFetch = jest.fn();
  beforeEach(() => {
    (global as any).fetch = mockFetch;
    mockFetch.mockReset();
  });

  it("GETs the authenticated nested transcripts route with the Bearer JWT and maps results", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        transcripts: [
          {
            sourceId: "src_1",
            jobName: "rojanda-x",
            text: "Bu dersi kaydediyorum",
            language: "tr-TR",
            status: "ready",
            durationSeconds: 6.21,
            createdAt: "2026-09-30T19:40:34Z",
          },
        ],
      }),
    });
    const api = createApiClient("https://api.example.com", async () => "jwt-t");
    const trs = await new ApiTranscriptService(api).listByLesson("course_1", "lesson_1");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/courses/course_1/lessons/lesson_1/transcripts");
    expect(init.method).toBe("GET");
    expect(init.headers.Authorization).toBe("Bearer jwt-t");
    expect(init.body).toBeUndefined();
    expect(trs).toEqual([
      {
        sourceId: "src_1",
        text: "Bu dersi kaydediyorum",
        language: "tr-TR",
        status: "ready",
        durationSeconds: 6.21,
        createdAt: "2026-09-30T19:40:34Z",
      },
    ]);
  });

  it("fails closed without a session (no request sent)", async () => {
    const api = createApiClient("https://api.example.com", async () => null);
    await expect(new ApiTranscriptService(api).listByLesson("c", "l")).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns an empty list when the lesson has no transcripts yet", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ transcripts: [] }) });
    const api = createApiClient("https://api.example.com", async () => "jwt");
    await expect(new ApiTranscriptService(api).listByLesson("c", "l")).resolves.toEqual([]);
  });
});

describe("selectLessonTranscriptText", () => {
  const tr = (text: string, createdAt: string, status = "ready") => ({ sourceId: "s", text, createdAt, status });

  it("prefers the server transcript over empty local text (backend-recovered lesson)", () => {
    expect(selectLessonTranscriptText([tr("sunucu metni", "2026-09-30T19:40:34Z")], undefined)).toBe("sunucu metni");
  });

  it("prefers the newest ready server transcript", () => {
    expect(
      selectLessonTranscriptText([tr("eski", "2026-09-30T18:00:00Z"), tr("yeni", "2026-09-30T19:00:00Z")], "yerel")
    ).toBe("yeni");
  });

  it("ignores blank or non-ready server transcripts and falls back to local text", () => {
    expect(selectLessonTranscriptText([tr("   ", "b"), tr("hazır değil", "c", "processing")], "yerel metin")).toBe(
      "yerel metin"
    );
  });

  it("returns undefined when nothing real exists (never invents text)", () => {
    expect(selectLessonTranscriptText([], undefined)).toBeUndefined();
    expect(selectLessonTranscriptText([], "  ")).toBeUndefined();
  });
});
