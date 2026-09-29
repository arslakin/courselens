/**
 * Source → learning-material pipeline (photo / document / txt).
 *
 * Composes: create lesson → preserve the original source (uri + extracted
 * text, associated with user+course+lesson) → grounded analysis → attach the
 * study set → mark ready. Grounding: the study set is produced by the
 * AnalysisBackend from the source's OWN extracted text.
 *
 * Kept here (not in a screen) so mobile and future web reuse the same flow, and
 * so it can be swapped to the remote backend with no UI change.
 */
import type { Id, Lesson, SourceKind, StudySet } from "@rojanda/types";
import type { AnalysisBackend, Services, SourceInputKind } from "@rojanda/api";

export interface ProcessSourceInput {
  userId: Id;
  courseId: Id;
  title: string;
  kind: SourceKind; // photo | pdf | doc | txt
  uri?: string; // preserved so the student can return to the original
  mime?: string;
  /** Text already known (typed/pasted/txt). If absent, the backend extracts. */
  text?: string;
}

export interface ProcessSourceResult {
  lesson: Lesson;
  study: StudySet;
  extractedPlaceholder: boolean;
}

const toInputKind = (k: SourceKind): SourceInputKind =>
  k === "photo" ? "image" : k === "pdf" ? "pdf" : k === "doc" ? "doc" : "txt";

export async function processSourceToLesson(
  services: Services,
  backend: AnalysisBackend,
  input: ProcessSourceInput,
  opts?: { quizLength?: 10 | 20 }
): Promise<ProcessSourceResult> {
  const lesson = await services.lessons.create(input.courseId, input.userId, input.title);
  await services.lessons.update(lesson.id, { status: "analyzing" });

  // Extract text from the source (real for text; backend/OCR for images).
  const extracted = await backend.extract(toInputKind(input.kind), {
    uri: input.uri,
    text: input.text,
  });

  // Preserve the original source, associated with user+lesson.
  await services.sources.add(lesson.id, input.userId, input.kind, {
    uri: input.uri,
    mime: input.mime,
    extractedText: extracted.text,
  });

  // Grounded analysis from the source's own text.
  const quizLength =
    opts?.quizLength ?? (await services.profile.get(input.userId)).preferences.quizLength;
  const study = await backend.analyze(extracted.text, { language: "tr", quizLength });

  const podcast = await services.podcast.generate(lesson.id, study);
  const withPodcast: StudySet = { ...study, podcast };
  const ready = await services.lessons.update(lesson.id, { status: "ready", study: withPodcast });

  return { lesson: ready, study: withPodcast, extractedPlaceholder: extracted.placeholder };
}
