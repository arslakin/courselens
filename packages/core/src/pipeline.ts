/**
 * Lesson processing pipeline helper.
 *
 * Composes the transcription + study services into the single async flow the
 * UI cares about, updating lesson.status at each step. Keeping this here (not
 * in a screen) means the record->transcribe->analyze orchestration can be
 * reused by web later and swapped to the real async AWS pipeline without
 * touching UI.
 */
import type { Id, Lesson, StudySet } from "@rojanda/types";
import type { Services } from "@rojanda/api";

export interface ProcessCallbacks {
  onStatus?: (status: Lesson["status"]) => void;
}

export async function processRecordedLesson(
  services: Services,
  lessonId: Id,
  audioUri: string,
  durationSec: number,
  cb: ProcessCallbacks = {}
): Promise<{ lesson: Lesson; study: StudySet }> {
  const setStatus = async (status: Lesson["status"]) => {
    cb.onStatus?.(status);
    await services.lessons.update(lessonId, { status });
  };

  await services.lessons.update(lessonId, { durationSec });
  await setStatus("uploaded");

  await setStatus("transcribing");
  const transcript = await services.transcription.transcribeLesson(lessonId, audioUri);
  await services.sources.add(lessonId, (await services.lessons.get(lessonId))!.userId, "recording", {
    uri: audioUri,
    extractedText: transcript.text,
  });
  await setStatus("transcribed");

  await setStatus("analyzing");
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
