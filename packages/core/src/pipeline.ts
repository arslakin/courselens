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
}

export interface ProcessRecordedResult {
  lesson: Lesson;
  study?: StudySet;
  /** True when we stopped at awaiting_transcription (no transcript yet). */
  awaitingTranscription: boolean;
}

export async function processRecordedLesson(
  services: Services,
  lessonId: Id,
  audioUri: string,
  durationSec: number,
  cb: ProcessCallbacks = {}
): Promise<ProcessRecordedResult> {
  const setStatus = async (status: Lesson["status"]) => {
    cb.onStatus?.(status);
    await services.lessons.update(lessonId, { status });
  };

  await services.lessons.update(lessonId, { durationSec });
  await setStatus("uploaded");

  await setStatus("transcribing");
  const transcript = await services.transcription.transcribeLesson(lessonId, audioUri);

  // Always preserve the audio as the student's own recording source, associated
  // with this user + lesson. extractedText carries the transcript text (empty
  // while pending — never fabricated).
  const owner = (await services.lessons.get(lessonId))!.userId;
  await services.sources.add(lessonId, owner, "recording", {
    uri: audioUri,
    extractedText: transcript.pending ? undefined : transcript.text,
  });

  if (transcript.pending) {
    // No transcript yet: stop honestly. Audio is saved and playable; the
    // student can revisit and analysis will run once transcription lands.
    const lesson = await services.lessons.update(lessonId, {
      status: "awaiting_transcription",
    });
    cb.onStatus?.("awaiting_transcription");
    return { lesson, awaitingTranscription: true };
  }

  await setStatus("transcribed");
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
