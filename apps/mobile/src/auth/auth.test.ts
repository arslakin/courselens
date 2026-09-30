/**
 * Client auth tests (Phase 1A): mock cannot become production auth; the
 * authenticated API client attaches a Bearer JWT and fails closed with no
 * session; unauthenticated requests never masquerade as authenticated.
 */
import { MockAuthProvider } from "./MockAuthProvider";
import { makeAuthorizedRequest } from "../services/makeTranscription";

describe("MockAuthProvider (dev only)", () => {
  it("is explicitly non-production and issues a clearly-fake, non-JWT token", async () => {
    const p = new MockAuthProvider();
    expect(p.isProduction).toBe(false);
    const session = await p.signIn("ogrenci@rojanda.app", "pw");
    // Fake token is not a real JWT (no dotted 3-segment JWT structure w/ payload).
    expect(session.idToken).toBe("dev-mock-token.not-a-real-jwt");
    // sub has the Cognito sub (UUID) shape for display/routing only.
    expect(session.identity.sub).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("has no session before sign-in and clears it on sign-out", async () => {
    const p = new MockAuthProvider();
    expect(await p.restoreSession()).toBeNull();
    expect(await p.getIdToken()).toBeNull();
    await p.signIn("a@b.co", "pw");
    expect(await p.getIdToken()).not.toBeNull();
    await p.signOut();
    expect(await p.getIdToken()).toBeNull();
  });
});

describe("authenticated API client (Bearer JWT)", () => {
  const mockFetch = jest.fn();
  beforeEach(() => {
    (global as any).fetch = mockFetch;
    mockFetch.mockReset();
  });

  it("attaches Authorization: Bearer <token> when a session exists", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    const req = makeAuthorizedRequest("https://api.example.com", async () => "jwt-123");
    await req("/transcribe/status?jobId=x", { method: "GET" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/transcribe/status?jobId=x");
    expect(init.headers.Authorization).toBe("Bearer jwt-123");
  });

  it("fails closed (401) and sends NO request when there is no session", async () => {
    const req = makeAuthorizedRequest("https://api.example.com", async () => null);
    const res = await req("/transcribe/start", { method: "POST", body: { audioKey: "k" } });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
    // Critically: no unauthenticated request is sent that could look authenticated.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("surfaces backend non-2xx without masquerading as success", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: "forbidden" } }),
    });
    const req = makeAuthorizedRequest("https://api.example.com", async () => "jwt");
    const res = await req("/transcribe/start", { method: "POST", body: {} });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
  });
});
