/**
 * Tests for the client RemoteTranscriptionService state machine, with a fully
 * mocked backend `request` and audio reader — no network, no AWS, no Expo. One
 * implementation is exercised for both entry points (transcribeLesson +
 * transcribeVoiceNote).
 */
import {
  RemoteTranscriptionService,
  TranscriptionFailedError,
  type AuthorizedRequest,
} from "./RemoteTranscriptionService";

// Minimal global stubs used by the upload step.
(global as any).FormData = class {
  private parts: any[] = [];
  append(k: string, v: any) {
    this.parts.push([k, v]);
  }
};
(global as any).fetch = jest.fn(async () => ({ ok: true, status: 204 }));

const readAudioBlob = async (_uri: string) => ({ size: 10 } as unknown as Blob);

/** Builds a scripted `request` that returns queued responses per path. */
function scriptedRequest(script: {
  uploadUrl?: { ok?: boolean; status?: number; json?: any };
  start?: { ok?: boolean; status?: number; json?: any };
  status?: Array<{ ok?: boolean; status?: number; json?: any }>;
  /** GET /courses/{c}/lessons/{l}/sources response (resume path). */
  sources?: { ok?: boolean; status?: number; json?: any };
  /** Per-jobId status responses (resume path); overrides `status` when set. */
  statusByJob?: Record<string, { ok?: boolean; status?: number; json?: any }>;
}): { request: AuthorizedRequest; calls: string[]; bodies: Record<string, any> } {
  const calls: string[] = [];
  const bodies: Record<string, any> = {};
  let statusIdx = 0;
  const request: AuthorizedRequest = async (path, init) => {
    calls.push(path);
    if (path.startsWith("/courses/") && path.endsWith("/sources")) {
      return {
        ok: script.sources?.ok ?? true,
        status: script.sources?.status ?? 200,
        json: script.sources?.json ?? { sources: [] },
      };
    }
    if (path.startsWith("/transcribe/status") && script.statusByJob) {
      const jobId = decodeURIComponent(path.split("jobId=")[1] || "");
      const r = script.statusByJob[jobId] ?? { ok: false, status: 404, json: { error: { code: "not_found" } } };
      return { ok: r.ok ?? true, status: r.status ?? 200, json: r.json };
    }
    if (path.startsWith("/transcribe/upload-url")) {
      bodies.uploadUrl = init.body;
      return {
        ok: script.uploadUrl?.ok ?? true,
        status: script.uploadUrl?.status ?? 200,
        json: script.uploadUrl?.json ?? {
          uploadUrl: "https://bucket.s3.amazonaws.com",
          fields: { key: "owners/aaa/courses/c/lessons/l/audio/x.m4a" },
          audioKey: "owners/aaa/courses/c/lessons/l/audio/x.m4a",
          sourceId: "src_test1",
        },
      };
    }
    if (path.startsWith("/transcribe/start")) {
      bodies.start = init.body;
      return {
        ok: script.start?.ok ?? true,
        status: script.start?.status ?? 200,
        json: script.start?.json ?? { jobId: "rojanda-eu-central-1-aaa-1", status: "IN_PROGRESS" },
      };
    }
    // status (may be polled multiple times)
    const entry = (script.status ?? [{ json: { status: "COMPLETED", transcript: "Merhaba" } }])[
      Math.min(statusIdx, (script.status?.length ?? 1) - 1)
    ];
    statusIdx += 1;
    return { ok: entry.ok ?? true, status: entry.status ?? 200, json: entry.json };
  };
  return { request, calls, bodies };
}

const noSleep = () => Promise.resolve();
// Ownership context the backend requires; passed by the pipeline in the app.
const CTX = { courseId: "course_1" };

describe("RemoteTranscriptionService", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 204 });
  });

  it("transcribeLesson: completed -> Turkish transcript (tr-TR), not fabricated", async () => {
    const { request } = scriptedRequest({
      status: [{ json: { status: "COMPLETED", transcript: "Bugün fotosentez işledik", confidenceAvg: 0.92 } }],
    });
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep });
    const t = await svc.transcribeLesson("lesson-1", "file:///rec.m4a", CTX);
    expect(t.language).toBe("tr-TR");
    expect(t.text).toBe("Bugün fotosentez işledik");
    expect(t.pending).toBe(false);
    expect(t.confidenceAvg).toBeCloseTo(0.92);
  });

  it("polls through IN_PROGRESS then COMPLETED", async () => {
    const { request, calls } = scriptedRequest({
      status: [
        { json: { status: "IN_PROGRESS" } },
        { json: { status: "IN_PROGRESS" } },
        { json: { status: "COMPLETED", transcript: "tamam" } },
      ],
    });
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep, pollIntervalMs: 1 });
    const t = await svc.transcribeLesson("l", "file:///a.m4a", CTX);
    expect(t.text).toBe("tamam");
    expect(calls.filter((c) => c.startsWith("/transcribe/status")).length).toBe(3);
  });

  it("FAILED status throws (audio preserved by caller; retryable)", async () => {
    const { request } = scriptedRequest({
      status: [{ json: { status: "FAILED", error: "bad audio" } }],
    });
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep });
    await expect(svc.transcribeLesson("l", "file:///a.m4a", CTX)).rejects.toBeInstanceOf(TranscriptionFailedError);
  });

  it("retry after failure re-runs upload+start with the same audio", async () => {
    // First attempt fails at status; second completes.
    const first = scriptedRequest({ status: [{ json: { status: "FAILED", error: "x" } }] });
    const svc1 = new RemoteTranscriptionService({ request: first.request, readAudioBlob, sleep: noSleep });
    await expect(svc1.transcribeLesson("l", "file:///same.m4a", CTX)).rejects.toBeTruthy();

    const second = scriptedRequest({ status: [{ json: { status: "COMPLETED", transcript: "ikinci deneme" } }] });
    const svc2 = new RemoteTranscriptionService({ request: second.request, readAudioBlob, sleep: noSleep });
    const t = await svc2.transcribeLesson("l", "file:///same.m4a", CTX);
    expect(t.text).toBe("ikinci deneme");
    expect(second.calls).toContain("/transcribe/upload-url");
    expect(second.calls).toContain("/transcribe/start");
  });

  it("oversized upload rejected by S3 -> TranscriptionFailedError (no start)", async () => {
    const { request, calls } = scriptedRequest({});
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 403 }); // S3 EntityTooLarge
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep });
    await expect(svc.transcribeLesson("l", "file:///big.m4a", CTX)).rejects.toBeInstanceOf(TranscriptionFailedError);
    expect(calls).not.toContain("/transcribe/start");
  });

  it("transcribeVoiceNote: returns text, or null when empty (never fabricated)", async () => {
    const withText = scriptedRequest({ status: [{ json: { status: "COMPLETED", transcript: "kısa not" } }] });
    const svc = new RemoteTranscriptionService({ request: withText.request, readAudioBlob, sleep: noSleep });
    expect(await svc.transcribeVoiceNote("file:///n.m4a", { courseId: "c", lessonId: "l" })).toBe("kısa not");

    const empty = scriptedRequest({ status: [{ json: { status: "COMPLETED", transcript: "   " } }] });
    const svc2 = new RemoteTranscriptionService({ request: empty.request, readAudioBlob, sleep: noSleep });
    expect(await svc2.transcribeVoiceNote("file:///n.m4a", { courseId: "c", lessonId: "l" })).toBeNull();
  });

  it("poll timeout throws rather than hanging or fabricating", async () => {
    let t = 0;
    const { request } = scriptedRequest({ status: [{ json: { status: "IN_PROGRESS" } }] });
    const svc = new RemoteTranscriptionService({
      request,
      readAudioBlob,
      sleep: noSleep,
      pollIntervalMs: 1,
      maxPollMs: 5,
      now: () => (t += 10), // advances past the deadline immediately
    });
    await expect(svc.transcribeLesson("l", "file:///a.m4a", CTX)).rejects.toBeInstanceOf(TranscriptionFailedError);
  });

  it("start error surfaces the backend message", async () => {
    const { request } = scriptedRequest({
      start: { ok: false, status: 429, json: { error: { code: "daily_quota", message: "Günlük transkript sınırına ulaşıldı." } } },
    });
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep });
    await expect(svc.transcribeLesson("l", "file:///a.m4a", CTX)).rejects.toThrow("Günlük transkript");
  });

  // Regression for the real-device "Ders bulunamadı." bug: the backend scopes
  // the upload/job to the owner's course+lesson, so courseId + lessonId MUST be
  // sent in the request bodies, and the sourceId from upload-url must be
  // forwarded to start.
  it("sends courseId + lessonId to upload-url and start, and forwards sourceId", async () => {
    const { request, bodies } = scriptedRequest({
      status: [{ json: { status: "COMPLETED", transcript: "tamam" } }],
    });
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep });
    await svc.transcribeLesson("lesson_9", "file:///a.m4a", { courseId: "course_9" });
    expect(bodies.uploadUrl).toEqual({ courseId: "course_9", lessonId: "lesson_9" });
    expect(bodies.start).toEqual({
      audioKey: "owners/aaa/courses/c/lessons/l/audio/x.m4a",
      courseId: "course_9",
      lessonId: "lesson_9",
      sourceId: "src_test1",
    });
  });

  // --- Retry/resume: never re-upload or start a duplicate job when a usable
  // job already exists for the recording. ---------------------------------
  const RESUME = { courseId: "course_9", resumeExisting: true };
  const src = (jobName: string, createdAt: string) => ({ kind: "recording", jobName, createdAt, sourceId: jobName });

  it("resume: COMPLETED existing job -> uses its transcript, no upload/start", async () => {
    const { request, calls } = scriptedRequest({
      sources: { json: { sources: [src("job-old", "2026-01-01T00:00:00Z"), src("job-new", "2026-01-02T00:00:00Z")] } },
      statusByJob: { "job-new": { json: { status: "COMPLETED", transcript: "Bu dersi kaydediyorum" } } },
    });
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep });
    const t = await svc.transcribeLesson("lesson_9", "file:///a.m4a", RESUME);
    expect(t.text).toBe("Bu dersi kaydediyorum");
    expect(calls).toContain("/courses/course_9/lessons/lesson_9/sources");
    expect(calls).toContain("/transcribe/status?jobId=job-new"); // newest first
    expect(calls).not.toContain("/transcribe/status?jobId=job-old");
    expect(calls).not.toContain("/transcribe/upload-url");
    expect(calls).not.toContain("/transcribe/start");
    expect(global.fetch as jest.Mock).not.toHaveBeenCalled(); // no S3 re-upload
  });

  it("resume: IN_PROGRESS existing job -> keeps polling that job", async () => {
    let n = 0;
    const calls: string[] = [];
    const request: AuthorizedRequest = async (path) => {
      calls.push(path);
      if (path.endsWith("/sources")) return { ok: true, status: 200, json: { sources: [src("job-a", "2026-01-01")] } };
      n += 1;
      return { ok: true, status: 200, json: n < 3 ? { status: "IN_PROGRESS" } : { status: "COMPLETED", transcript: "tamam" } };
    };
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep, pollIntervalMs: 1 });
    const t = await svc.transcribeLesson("lesson_9", "file:///a.m4a", RESUME);
    expect(t.text).toBe("tamam");
    expect(calls.filter((c) => c === "/transcribe/status?jobId=job-a").length).toBe(3);
    expect(calls).not.toContain("/transcribe/upload-url");
  });

  it("resume: only FAILED/gone jobs -> starts ONE new job", async () => {
    const { request, calls } = scriptedRequest({
      sources: { json: { sources: [src("job-failed", "2026-01-02"), src("job-gone", "2026-01-01")] } },
      statusByJob: {
        "job-failed": { json: { status: "FAILED", error: "bad media" } },
        // job-gone not listed -> 404
        "rojanda-eu-central-1-aaa-1": { json: { status: "COMPLETED", transcript: "yeni iş" } },
      },
    });
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep });
    const t = await svc.transcribeLesson("lesson_9", "file:///a.m4a", RESUME);
    expect(t.text).toBe("yeni iş");
    expect(calls.filter((c) => c === "/transcribe/upload-url").length).toBe(1);
    expect(calls.filter((c) => c === "/transcribe/start").length).toBe(1);
  });

  it("resume: no existing job -> starts a new job", async () => {
    const { request, calls } = scriptedRequest({
      sources: { json: { sources: [] } },
      status: [{ json: { status: "COMPLETED", transcript: "ilk" } }],
    });
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep });
    const t = await svc.transcribeLesson("lesson_9", "file:///a.m4a", RESUME);
    expect(t.text).toBe("ilk");
    expect(calls).toContain("/transcribe/start");
  });

  it("resume: transient backend error on existing job -> throws, NO duplicate job", async () => {
    const { request, calls } = scriptedRequest({
      sources: { json: { sources: [src("job-done", "2026-01-01")] } },
      statusByJob: {
        "job-done": { ok: false, status: 502, json: { error: { code: "transcript_unavailable", message: "Transkript alınamadı. Lütfen tekrar deneyin." } } },
      },
    });
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep });
    await expect(svc.transcribeLesson("lesson_9", "file:///a.m4a", RESUME)).rejects.toThrow("Transkript alınamadı");
    expect(calls).not.toContain("/transcribe/upload-url");
    expect(calls).not.toContain("/transcribe/start");
  });

  it("first attempt (no resumeExisting) never lists sources", async () => {
    const { request, calls } = scriptedRequest({ status: [{ json: { status: "COMPLETED", transcript: "x" } }] });
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep });
    await svc.transcribeLesson("lesson_9", "file:///a.m4a", { courseId: "course_9" });
    expect(calls.some((c) => c.endsWith("/sources"))).toBe(false);
  });

  it("fails fast (no network) when ownership context is missing", async () => {
    const { request, calls } = scriptedRequest({});
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep });
    // No ctx.courseId -> must throw before any request, never send a bad call
    // that the backend would answer with a generic 404.
    await expect(svc.transcribeLesson("lesson_9", "file:///a.m4a")).rejects.toThrow(/eksik/);
    expect(calls).toHaveLength(0);
  });
});
