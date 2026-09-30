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
   *  caller keeps the audio and can retry. */
  async transcribeLesson(_lessonId: Id, audioUri: string): Promise<Transcript> {
    const { text, confidenceAvg } = await this.runJob(audioUri);
    return {
      id: `tr-${this.now()}`,
      lessonId: _lessonId,
      text,
      language: "tr-TR",
      confidenceAvg: confidenceAvg ?? undefined,
      editedByUser: false,
      pending: false,
    };
  }

  /** Short voice note -> Turkish text (or null if empty). Throws on failure so
   *  the student keeps the audio and may type the note / retry. */
  async transcribeVoiceNote(audioUri: string): Promise<string | null> {
    const { text } = await this.runJob(audioUri);
    return text.trim().length > 0 ? text : null;
  }

  // --- shared upload -> start -> poll pipeline (one implementation) ---------
  private async runJob(audioUri: string): Promise<{ text: string; confidenceAvg?: number }> {
    const audioKey = await this.upload(audioUri);
    const jobId = await this.start(audioKey);
    return this.poll(jobId);
  }

  private async upload(audioUri: string): Promise<string> {
    const res = await this.deps.request("/transcribe/upload-url", { method: "POST", body: {} });
    if (!res.ok) throw new Error(this.errMsg(res, "upload-url"));
    const { uploadUrl, fields, audioKey } = res.json as {
      uploadUrl: string;
      fields: Record<string, string>;
      audioKey: string;
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
    return audioKey;
  }

  private async start(audioKey: string): Promise<string> {
    const res = await this.deps.request("/transcribe/start", { method: "POST", body: { audioKey } });
    if (!res.ok) throw new Error(this.errMsg(res, "start"));
    return (res.json as { jobId: string }).jobId;
  }

  private async poll(jobId: string): Promise<{ text: string; confidenceAvg?: number }> {
    const deadline = this.now() + this.maxPollMs;
    // First check immediately, then at intervals until terminal or timeout.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await this.deps.request(
        `/transcribe/status?jobId=${encodeURIComponent(jobId)}`,
        { method: "GET" }
      );
      if (!res.ok) throw new Error(this.errMsg(res, "status"));
      const s = res.json as {
        status: "IN_PROGRESS" | "COMPLETED" | "FAILED";
        transcript?: string;
        confidenceAvg?: number;
        error?: string;
      };
      if (s.status === "COMPLETED") {
        // Only ever the backend's real transcript — never fabricated.
        return { text: s.transcript ?? "", confidenceAvg: s.confidenceAvg };
      }
      if (s.status === "FAILED") {
        throw new TranscriptionFailedError(s.error ?? "unknown");
      }
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
