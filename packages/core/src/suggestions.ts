/**
 * Suggested-next-study-action logic.
 *
 * Derived ONLY from the student's own RojAnda activity/materials — never from
 * outside data and never from another user. Deterministic and rule-based (no
 * invented performance claims): it just points the student at the most useful
 * next step given what they already have.
 */
import type { Course, Lesson } from "@rojanda/types";

export type SuggestionKind =
  | "create_course"
  | "record"
  | "quiz"
  | "flashcards"
  | "review";

export interface Suggestion {
  kind: SuggestionKind;
  /** The lesson the suggestion refers to, when applicable. */
  lesson?: Lesson;
}

/**
 * @param courses the user's own courses
 * @param lessons the user's own lessons (most-recent first not required)
 * @param studiedLessonIds lessons the user has already quizzed/flashcarded
 */
export function nextSuggestion(
  courses: Course[],
  lessons: Lesson[],
  studiedLessonIds: Set<string> = new Set()
): Suggestion {
  if (courses.length === 0) return { kind: "create_course" };

  const ready = lessons
    .filter((l) => l.status === "ready")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  if (ready.length === 0) return { kind: "record" };

  // Prefer a ready lesson the student hasn't studied yet: suggest a quiz.
  const unstudied = ready.find((l) => !studiedLessonIds.has(l.id));
  if (unstudied) return { kind: "quiz", lesson: unstudied };

  // Otherwise nudge review of the most recent lesson.
  return { kind: "review", lesson: ready[0] };
}
