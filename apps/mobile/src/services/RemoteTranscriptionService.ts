/**
 * RemoteTranscriptionService — real Turkish (tr-TR) transcription against the
 * isolated `rojanda-transcribe` backend. Implements the SAME TranscriptionService
 * interface used by both Dersi Kaydet (transcribeLesson) and Sesli Not
 * (transcribeVoiceNote), so screens and the pipeline are unchanged.
 *
 * Flow (per call): read audio bytes -> POST /transcribe/upload-url (presigned
 * POST) -> multipart POST the .m4a to S3 -> POST /transcribe/start -> poll
 * GET /transcribe/status until COMPLETED/FAILED.
 *
 * No AWS credentials live here. All backend calls go through an injected
 * `authorizedRequest` that attaches the caller's Cognito User Pool **JWT**
 * (`Authorization: Bearer <idToken>`) — NOT SigV4, NOT Identity Pool AWS
 * credentials. This service is only wired in when TRANSCRIBE_BASE_URL is
 * configured; otherwise the honest PendingTranscriptionService remains the
 * default (unchanged behavior).
 *
 * Honesty guarantees:
 *  - Never fabricates transcript text — text is only what the backend returns.
 *  - On FAILED (or any error) it THROWS; the caller preserves the audio and the
 *    lesson stays in `awaiting_transcription`, so the student can retry.
 *  - A retry simply calls transcribeLesson again with the same preserved audio.
 */
import type { Id, Transcript } from "@rojanda/types";
import type { TranscriptionService } from "@rojanda/api";

/** Minimal HTTP surface so this is testable with a mocked fetch and carries no
 * AWS SDK dependency in the bundle unless the app actually configures it. */
export interface AuthorizedRequest {
  /** JWT-authorized JSON request to the backend (Bearer token); resolves parsed JSON. */
  (path: string, init: { method: "GET" | "POST"; body?: unknown }): Promise<{
    ok: boolean;
    status: number;
    json: any;
  }>;
}

/** Reads the local audio file into a Blob for the multipart S3 upload. */
export interface ReadAudioBlob {
  (uri: string): Promise<Blob>;
}

export interface RemoteTranscriptionDeps {
  request: AuthorizedRequest;
  readAudioBlob: ReadAudioBlob;
  /** Wall-clock poll settings; small + bounded. Overridable in tests. */
  pollIntervalMs?: number;
  maxPollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class TranscriptionFailedError extends Error {
  constructor(public readonly reason: string) {
    super(`transcription-failed: ${reason}`);
    this.name = "TranscriptionFailedError";
  }
}

export class RemoteTranscriptionService implements TranscriptionService {
  private readonly pollIntervalMs: number;
  private readonly maxPollMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private deps: RemoteTranscriptionDeps) {
    this.pollIntervalMs = deps.pollIntervalMs ?? 3000;
    this.maxPollMs = deps.maxPollMs ?? 10 * 60 * 1000;
    this.now = deps.now ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Full lecture recording -> Turkish transcript. Throws on failure so the
   *  caller keeps the audio and can retry.
   *
   *  The backend scopes the upload + job to the owner's course + lesson, so it
   *  REQUIRES courseId + lessonId in the request bodies (server-side ownership
   *  check). Without them the backend returns 404 "Ders bulunamadı." */
  async transcribeLesson(
    lessonId: Id,
    audioUri: string,
    ctx?: { courseId?: Id; resumeExisting?: boolean }
  ): Promise<Transcript> {
    const resumed = ctx?.resumeExisting ? await this.resumeExisting(ctx?.courseId, lessonId) : null;
    const { text, confidenceAvg } = resumed ?? (await this.runJob(audioUri, ctx?.courseId, lessonId));
    return {
      id: `tr-${this.now()}`,
      lessonId,
      text,
      language: "tr-TR",
      confidenceAvg: confidenceAvg ?? undefined,
      editedByUser: false,
      pending: false,
    };
  }

  /** Short voice note -> Turkish text (or null if empty). Throws on failure so
   *  the student keeps the audio and may type the note / retry. */
  async transcribeVoiceNote(
    audioUri: string,
    ctx?: { courseId?: Id; lessonId?: Id }
  ): Promise<string | null> {
    const { text } = await this.runJob(audioUri, ctx?.courseId, ctx?.lessonId);
    return text.trim().length > 0 ? text : null;
  }

  // --- shared upload -> start -> poll pipeline (one implementation) ---------
  private async runJob(
    audioUri: string,
    courseId?: Id,
    lessonId?: Id
  ): Promise<{ text: string; confidenceAvg?: number }> {
    // Fail fast with a clear message if ownership context is missing — the
    // backend would otherwise reject with a generic 404.
    if (!courseId || !lessonId) {
      throw new Error("Transkripsiyon için ders/ders kaydı bilgisi eksik.");
    }
    const { audioKey, sourceId } = await this.upload(audioUri, courseId, lessonId);
    const jobId = await this.start(audioKey, courseId, lessonId, sourceId);
    return this.poll(jobId);
  }

  private async upload(
    audioUri: string,
    courseId: Id,
    lessonId: Id
  ): Promise<{ audioKey: string; sourceId: string }> {
    const res = await this.deps.request("/transcribe/upload-url", {
      method: "POST",
      body: { courseId, lessonId },
    });
    if (!res.ok) throw new Error(this.errMsg(res, "upload-url"));
    const { uploadUrl, fields, audioKey, sourceId } = res.json as {
      uploadUrl: string;
      fields: Record<string, string>;
      audioKey: string;
      sourceId: string;
    };

    // Multipart POST to S3 with the signed policy fields + the file last.
    const blob = await this.deps.readAudioBlob(audioUri);
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => form.append(k, v));
    // RN/Expo FormData accepts a Blob/file part at runtime; cast for TS.
    form.append("file", blob as unknown as string);
    const s3res = await fetch(uploadUrl, { method: "POST", body: form as any });
    if (!s3res.ok) {
      // e.g. 403 EntityTooLarge when the file exceeds content-length-range.
      throw new TranscriptionFailedError(`upload-rejected-${s3res.status}`);
    }
    return { audioKey, sourceId };
  }

  private async start(audioKey: string, courseId: Id, lessonId: Id, sourceId: string): Promise<string> {
    const res = await this.deps.request("/transcribe/start", {
      method: "POST",
      body: { audioKey, courseId, lessonId, sourceId },
    });
    if (!res.ok) throw new Error(this.errMsg(res, "start"));
    return (res.json as { jobId: string }).jobId;
  }

  /**
   * Retry path: resume an EXISTING job for this lesson's recording instead of
   * re-uploading + starting a new one. Candidates are the lesson's server-side
   * recording sources that carry a jobName, newest first:
   *  - COMPLETED   -> use its transcript (backend persists it + settles usage)
   *  - IN_PROGRESS -> keep polling that same job
   *  - FAILED / job gone (404/403) -> not usable; try the next candidate
   * Returns null only when NO usable job exists (caller then starts a new one).
   * Any other error (e.g. 502 transcript_unavailable) is thrown so the lesson
   * stays retryable WITHOUT creating a duplicate job.
   */
  private async resumeExisting(
    courseId: Id | undefined,
    lessonId: Id
  ): Promise<{ text: string; confidenceAvg?: number } | null> {
    if (!courseId || !lessonId) {
      throw new Error("Transkripsiyon için ders/ders kaydı bilgisi eksik.");
    }
    const res = await this.deps.request(
      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/sources`,
      { method: "GET" }
    );
    if (!res.ok) throw new Error(this.errMsg(res, "sources"));
    const sources = ((res.json && res.json.sources) || []) as Array<{
      kind?: string;
      jobName?: string;
      createdAt?: string;
    }>;
    const candidates = sources
      .filter((s) => s.kind === "recording" && typeof s.jobName === "string" && s.jobName)
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    for (const c of candidates) {
      const first = await this.statusOnce(c.jobName!);
      if (first.state === "COMPLETED") return { text: first.text, confidenceAvg: first.confidenceAvg };
      if (first.state === "IN_PROGRESS") return this.poll(c.jobName!);
      // FAILED or GONE -> this job is not usable; try the next one.
    }
    return null;
  }

  /** One status check, classified. Throws on unexpected (non-404/403) errors. */
  private async statusOnce(
    jobId: string
  ): Promise<
    | { state: "COMPLETED"; text: string; confidenceAvg?: number }
    | { state: "IN_PROGRESS" }
    | { state: "FAILED"; reason: string }
    | { state: "GONE" }
  > {
    const res = await this.deps.request(`/transcribe/status?jobId=${encodeURIComponent(jobId)}`, {
      method: "GET",
    });
    if (!res.ok) {
      if (res.status === 404 || res.status === 403) return { state: "GONE" };
      throw new Error(this.errMsg(res, "status"));
    }
    const s = res.json as {
      status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
      transcript?: string;
      confidenceAvg?: number;
      error?: string;
    };
    if (s.status === "COMPLETED") {
      // Only ever the backend's real transcript — never fabricated.
      return { state: "COMPLETED", text: s.transcript ?? "", confidenceAvg: s.confidenceAvg };
    }
    if (s.status === "FAILED") return { state: "FAILED", reason: s.error ?? "unknown" };
    return { state: "IN_PROGRESS" };
  }

  private async poll(jobId: string): Promise<{ text: string; confidenceAvg?: number }> {
    const deadline = this.now() + this.maxPollMs;
    // First check immediately, then at intervals until terminal or timeout.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const s = await this.statusOnce(jobId);
      if (s.state === "COMPLETED") return { text: s.text, confidenceAvg: s.confidenceAvg };
      if (s.state === "FAILED") throw new TranscriptionFailedError(s.reason);
      if (s.state === "GONE") throw new TranscriptionFailedError("job-not-found");
      if (this.now() >= deadline) {
        throw new TranscriptionFailedError("timeout");
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  private errMsg(res: { status: number; json: any }, where: string): string {
    const m = res.json && res.json.error && res.json.error.message;
    return m || `İstek başarısız (${where} ${res.status})`;
  }
}
