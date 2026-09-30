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
}): { request: AuthorizedRequest; calls: string[] } {
  const calls: string[] = [];
  let statusIdx = 0;
  const request: AuthorizedRequest = async (path, _init) => {
    calls.push(path);
    if (path.startsWith("/transcribe/upload-url")) {
      return {
        ok: script.uploadUrl?.ok ?? true,
        status: script.uploadUrl?.status ?? 200,
        json: script.uploadUrl?.json ?? {
          uploadUrl: "https://bucket.s3.amazonaws.com",
          fields: { key: "users/us-east-1:aaa/audio/x.m4a" },
          audioKey: "users/us-east-1:aaa/audio/x.m4a",
        },
      };
    }
    if (path.startsWith("/transcribe/start")) {
      return {
        ok: script.start?.ok ?? true,
        status: script.start?.status ?? 200,
        json: script.start?.json ?? { jobId: "rojanda-us-east-1-aaa-1", status: "IN_PROGRESS" },
      };
    }
    // status (may be polled multiple times)
    const entry = (script.status ?? [{ json: { status: "COMPLETED", transcript: "Merhaba" } }])[
      Math.min(statusIdx, (script.status?.length ?? 1) - 1)
    ];
    statusIdx += 1;
    return { ok: entry.ok ?? true, status: entry.status ?? 200, json: entry.json };
  };
  return { request, calls };
}

const noSleep = () => Promise.resolve();

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
    const t = await svc.transcribeLesson("lesson-1", "file:///rec.m4a");
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
    const t = await svc.transcribeLesson("l", "file:///a.m4a");
    expect(t.text).toBe("tamam");
    expect(calls.filter((c) => c.startsWith("/transcribe/status")).length).toBe(3);
  });

  it("FAILED status throws (audio preserved by caller; retryable)", async () => {
    const { request } = scriptedRequest({
      status: [{ json: { status: "FAILED", error: "bad audio" } }],
    });
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep });
    await expect(svc.transcribeLesson("l", "file:///a.m4a")).rejects.toBeInstanceOf(TranscriptionFailedError);
  });

  it("retry after failure re-runs upload+start with the same audio", async () => {
    // First attempt fails at status; second completes.
    const first = scriptedRequest({ status: [{ json: { status: "FAILED", error: "x" } }] });
    const svc1 = new RemoteTranscriptionService({ request: first.request, readAudioBlob, sleep: noSleep });
    await expect(svc1.transcribeLesson("l", "file:///same.m4a")).rejects.toBeTruthy();

    const second = scriptedRequest({ status: [{ json: { status: "COMPLETED", transcript: "ikinci deneme" } }] });
    const svc2 = new RemoteTranscriptionService({ request: second.request, readAudioBlob, sleep: noSleep });
    const t = await svc2.transcribeLesson("l", "file:///same.m4a");
    expect(t.text).toBe("ikinci deneme");
    expect(second.calls).toContain("/transcribe/upload-url");
    expect(second.calls).toContain("/transcribe/start");
  });

  it("oversized upload rejected by S3 -> TranscriptionFailedError (no start)", async () => {
    const { request, calls } = scriptedRequest({});
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 403 }); // S3 EntityTooLarge
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep });
    await expect(svc.transcribeLesson("l", "file:///big.m4a")).rejects.toBeInstanceOf(TranscriptionFailedError);
    expect(calls).not.toContain("/transcribe/start");
  });

  it("transcribeVoiceNote: returns text, or null when empty (never fabricated)", async () => {
    const withText = scriptedRequest({ status: [{ json: { status: "COMPLETED", transcript: "kısa not" } }] });
    const svc = new RemoteTranscriptionService({ request: withText.request, readAudioBlob, sleep: noSleep });
    expect(await svc.transcribeVoiceNote("file:///n.m4a")).toBe("kısa not");

    const empty = scriptedRequest({ status: [{ json: { status: "COMPLETED", transcript: "   " } }] });
    const svc2 = new RemoteTranscriptionService({ request: empty.request, readAudioBlob, sleep: noSleep });
    expect(await svc2.transcribeVoiceNote("file:///n.m4a")).toBeNull();
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
    await expect(svc.transcribeLesson("l", "file:///a.m4a")).rejects.toBeInstanceOf(TranscriptionFailedError);
  });

  it("start error surfaces the backend message", async () => {
    const { request } = scriptedRequest({
      start: { ok: false, status: 429, json: { error: { code: "daily_quota", message: "Günlük transkript sınırına ulaşıldı." } } },
    });
    const svc = new RemoteTranscriptionService({ request, readAudioBlob, sleep: noSleep });
    await expect(svc.transcribeLesson("l", "file:///a.m4a")).rejects.toThrow("Günlük transkript");
  });
});
