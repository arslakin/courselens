/**
 * RojAnda shared domain types.
 *
 * Single source of truth for the data model, shared today by the mobile app
 * and — later — the web app and backend. Mirrors the entities in
 * rojanda/ARCHITECTURE.md (User, Course, Lesson, Source, Recording,
 * Transcript, Summary, Concepts, Explanations, Flashcards, Quiz, Podcast,
 * Chat, Note).
 *
 * All of this is PRIVATE student data (see rojanda/ARCHITECTURE.md §9).
 */

export type ISODateString = string;
export type Id = string;

/** Default app locale is Turkish; localization-ready for more later. */
export type Locale = "tr" | "en";

// --- Account ---------------------------------------------------------------

export interface User {
  id: Id;
  email: string;
  displayName: string;
  locale: Locale;
  createdAt: ISODateString;
}

// --- Course / Lesson -------------------------------------------------------

export interface Course {
  id: Id;
  userId: Id;
  title: string;
  color?: string;
  createdAt: ISODateString;
}

/**
 * Lifecycle of a recorded lesson. Mirrors the async pipeline
 * (record -> upload -> transcribe -> analyze -> ready).
 */
export type LessonStatus =
  | "draft"
  | "uploaded"
  | "transcribing"
  | "transcribed"
  | "analyzing"
  | "ready"
  | "failed";

export interface Lesson {
  id: Id;
  courseId: Id;
  userId: Id;
  title: string;
  status: LessonStatus;
  durationSec?: number;
  createdAt: ISODateString;
  /** Populated once analysis completes. */
  study?: StudySet;
}

// --- Sources (own materials) ----------------------------------------------

export type SourceKind = "recording" | "voice_note" | "photo" | "pdf" | "doc" | "txt";

/** All sources are the student's OWN material (origin = "own"). */
export interface Source {
  id: Id;
  lessonId: Id;
  userId: Id;
  kind: SourceKind;
  /** Local URI in this phase; S3 key later. */
  uri?: string;
  mime?: string;
  extractedText?: string;
  origin: "own";
  createdAt: ISODateString;
}

export interface Transcript {
  id: Id;
  lessonId: Id;
  text: string;
  language: string; // e.g. "tr-TR"
  confidenceAvg?: number;
  editedByUser: boolean;
}

// --- Generated study content ----------------------------------------------

export interface Concept {
  name: string;
  explanation: string;
  difficulty?: "easy" | "medium" | "hard";
}

export interface Explanation {
  concept: string;
  plain: string; // plain-Turkish explanation
}

export interface Flashcard {
  id: Id;
  front: string;
  back: string;
  /** Simple learner-marked state; no SRS algorithm yet. */
  state?: "unseen" | "known" | "review";
}

export type QuizDifficulty = "easy" | "medium" | "hard";

/** Multiple-choice question with exactly one correct option (A–D). */
export interface QuizQuestion {
  id: Id;
  prompt: string;
  options: [string, string, string, string]; // A, B, C, D
  correctIndex: 0 | 1 | 2 | 3;
  explanation: string;
  difficulty: QuizDifficulty;
  topic?: string;
}

export interface Quiz {
  id: Id;
  questions: QuizQuestion[]; // standard length is 10
}

export interface Podcast {
  id: Id;
  script: string;
  audioUri?: string; // mock/placeholder in this phase
  durationSec?: number;
}

/** The full generated study set for a lesson. */
export interface StudySet {
  summary: string;
  concepts: Concept[];
  explanations: Explanation[];
  flashcards: Flashcard[];
  quiz: Quiz;
  podcast?: Podcast;
}

// --- Notes (Notlarım) ------------------------------------------------------

export type NoteKind = "typed" | "voice";

export interface Note {
  id: Id;
  userId: Id;
  /** A note may be attached to a course and/or a lesson, or neither. */
  courseId?: Id;
  lessonId?: Id;
  kind: NoteKind;
  title?: string;
  body: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// --- Chat (RojAnda'ya Sor) -------------------------------------------------

export type ChatRole = "user" | "assistant";

/** Whether the assistant answered from the student's own sources or external. */
export type ChatProvenance = "grounded" | "external" | "not_found";

export interface ChatMessage {
  id: Id;
  lessonId?: Id;
  courseId?: Id;
  role: ChatRole;
  text: string;
  provenance?: ChatProvenance;
  /** Source ids the grounded answer used. */
  citedSourceIds?: Id[];
  createdAt: ISODateString;
}

// --- Quiz attempt / results ------------------------------------------------

export interface QuizAnswer {
  questionId: Id;
  selectedIndex: 0 | 1 | 2 | 3;
  correct: boolean;
}

export interface QuizResult {
  quizId: Id;
  answers: QuizAnswer[];
  score: number; // number correct
  total: number; // out of (10)
  percentage: number;
  weakTopics: string[];
}
