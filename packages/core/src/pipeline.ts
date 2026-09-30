/**
 * Lesson processing pipeline helper.
 *
 * Composes the transcription + study services into the single async flow the
 * UI cares about, updating lesson.status at each step. Keeping this here (not
 * in a screen) means the record->transcribe->analyze orchestration can be
 * reused by web later and swapped to the real async AWS pipeline without
 * touching UI.
 *
 * HONEST TRANSCRIPTION: if the transcription service reports a PENDING
 * transcript (no backend connected), we preserve the audio and stop at
 * `awaiting_transcription`. We never fabricate transcript text, and we do not
 * run grounded analysis on non-existent text. Analysis resumes automatically
 * once a real (or user-edited) transcript exists — see `analyzeLessonFromTranscript`.
 */
import type { Id, Lesson, StudySet, Transcript } from "@rojanda/types";
import type { Services } from "@rojanda/api";

export interface ProcessCallbacks {
  onStatus?: (status: Lesson["status"]) => void;
  /** Called when a transcription ATTEMPT fails (recording is still preserved). */
  onTranscriptionError?: (error: Error) => void;
}

export interface ProcessRecordedResult {
  lesson: Lesson;
  study?: StudySet;
  /** True when we stopped at awaiting_transcription (no transcript yet). */
  awaitingTranscription: boolean;
  /** True when a transcription attempt failed; the recording is preserved. */
  transcriptionFailed?: boolean;
}

export async function processRecordedLesson(
  services: Services,
  lessonId: Id,
  audioUri: string,
  durationSec: number,
  cb: ProcessCallbacks = {},
  /**
   * Authoritative owner id for filing the local recording source. Pass the
   * signed-in user id (Cognito sub). Needed because API-backed lessons return
   * a blanked `userId` (ownership is server-enforced), so deriving the owner
   * from the fetched lesson would misfile the source under an empty id.
   */
  owner?: Id
): Promise<ProcessRecordedResult> {
  const setStatus = async (status: Lesson["status"]) => {
    cb.onStatus?.(status);
    await services.lessons.update(lessonId, { status });
  };

  await services.lessons.update(lessonId, { durationSec });

  // Fetch the lesson once: the remote transcription backend needs the courseId
  // to scope the upload/job, and we use the lesson's userId as an owner
  // fallback for local services.
  const lessonForCtx = await services.lessons.get(lessonId);
  const resolvedOwner = owner || lessonForCtx?.userId || "";

  // -------------------------------------------------------------------------
  // STEP 1 — PERSIST THE RECORDING FIRST (never lose a captured recording).
  // The audio is saved as the student's own source and the lesson is marked
  // as an available recording BEFORE any transcription is attempted. This is
  // the durable outcome: even if transcription later fails, the recording
  // remains visible in Ders Kayıtları and stays playable.
  // -------------------------------------------------------------------------
  const source = await services.sources.add(lessonId, resolvedOwner, "recording", {
    uri: audioUri,
  });
  await setStatus("awaiting_transcription");

  // -------------------------------------------------------------------------
  // STEP 2 — TRANSCRIBE as a SEPARATE, failure-isolated step. A transcription
  // failure NEVER removes the recording; it moves the lesson to a clear,
  // retryable "transcription_failed" state and returns (does not throw), so
  // the UI can present the saved recording + a retry affordance.
  // -------------------------------------------------------------------------
  cb.onStatus?.("transcribing");
  await services.lessons.update(lessonId, { status: "transcribing" });

  let transcript: Transcript;
  try {
    transcript = await services.transcription.transcribeLesson(lessonId, audioUri, {
      courseId: lessonForCtx?.courseId,
    });
  } catch (e) {
    const lesson = await services.lessons.update(lessonId, { status: "transcription_failed" });
    cb.onStatus?.("transcription_failed");
    cb.onTranscriptionError?.(e instanceof Error ? e : new Error(String(e)));
    // Recording is preserved (source already added). Retryable, not thrown.
    return { lesson, awaitingTranscription: false, transcriptionFailed: true };
  }

  if (transcript.pending) {
    // No transcript yet (no backend / honest pending): keep the audio,
    // stop at awaiting_transcription. Analysis runs once a transcript exists.
    const lesson = await services.lessons.update(lessonId, { status: "awaiting_transcription" });
    cb.onStatus?.("awaiting_transcription");
    return { lesson, awaitingTranscription: true };
  }

  // Real transcript: attach it to the preserved recording source (if the
  // source service supports text updates) and run grounded analysis.
  if (services.sources.updateText) {
    await services.sources.updateText(source.id, transcript.text);
  }
  await setStatus("transcribed");
  const result = await analyzeLessonFromTranscript(services, lessonId, transcript, cb);
  return { ...result, awaitingTranscription: false };
}

/**
 * Retry transcription for a lesson whose recording is already saved (e.g. after
 * a "transcription_failed" state). Reuses the preserved audio — the student does
 * NOT re-record. Behaves like STEP 2 of processRecordedLesson.
 */
export async function retryLessonTranscription(
  services: Services,
  lessonId: Id,
  audioUri: string,
  cb: ProcessCallbacks = {}
): Promise<ProcessRecordedResult> {
  const lesson0 = await services.lessons.get(lessonId);
  cb.onStatus?.("transcribing");
  await services.lessons.update(lessonId, { status: "transcribing" });

  let transcript: Transcript;
  try {
    // Resume an existing job for this recording first (no re-upload, no new
    // job); a new job is created only when no usable job exists.
    transcript = await services.transcription.transcribeLesson(lessonId, audioUri, {
      courseId: lesson0?.courseId,
      resumeExisting: true,
    });
  } catch (e) {
    const lesson = await services.lessons.update(lessonId, { status: "transcription_failed" });
    cb.onStatus?.("transcription_failed");
    cb.onTranscriptionError?.(e instanceof Error ? e : new Error(String(e)));
    return { lesson, awaitingTranscription: false, transcriptionFailed: true };
  }

  if (transcript.pending) {
    const lesson = await services.lessons.update(lessonId, { status: "awaiting_transcription" });
    cb.onStatus?.("awaiting_transcription");
    return { lesson, awaitingTranscription: true };
  }

  // Attach transcript to the existing recording source if we can find it.
  if (services.sources.updateText) {
    const recording = (await services.sources.listByLesson(lessonId)).find((s) => s.kind === "recording");
    if (recording) await services.sources.updateText(recording.id, transcript.text);
  }
  await services.lessons.update(lessonId, { status: "transcribed" });
  cb.onStatus?.("transcribed");
  const result = await analyzeLessonFromTranscript(services, lessonId, transcript, cb);
  return { ...result, awaitingTranscription: false };
}

/**
 * Runs grounded analysis for a lesson that already has a real transcript, then
 * marks it ready. Separated so it can be triggered later (once transcription
 * completes) without re-recording.
 */
export async function analyzeLessonFromTranscript(
  services: Services,
  lessonId: Id,
  transcript: Transcript,
  cb: ProcessCallbacks = {}
): Promise<{ lesson: Lesson; study: StudySet }> {
  cb.onStatus?.("analyzing");
  await services.lessons.update(lessonId, { status: "analyzing" });

  const study = await services.study.analyze(lessonId, transcript);
  const podcast = await services.podcast.generate(lessonId, study);
  const withPodcast: StudySet = { ...study, podcast };

  const lesson = await services.lessons.update(lessonId, {
    status: "ready",
    study: withPodcast,
  });
  cb.onStatus?.("ready");
  return { lesson, study: withPodcast };
}
