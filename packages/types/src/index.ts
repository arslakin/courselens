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

/**
 * A signed-in student.
 *
 * IDENTITY vs PROFILE (Phase 1A):
 *  - `id` is the AUTHENTICATION IDENTITY and the authoritative ownerId. In
 *    production it is the immutable Cognito User Pool `sub`, derived by the
 *    BACKEND from the verified JWT. The client never asserts its own `id` as
 *    proof of ownership. `email` is authentication contact info, NOT an
 *    ownership/authorization identifier, and must never be used as ownerId.
 *  - Everything editable (displayName, preferences, school/grade, goals,
 *    language) is STUDENT PROFILE (`profile`) — mutable, non-authorizing.
 */
export interface User {
  /** Authoritative ownerId. Production = Cognito User Pool `sub` (immutable). */
  id: Id;
  /** Authentication contact only. NEVER an ownership/authorization identifier. */
  email: string;
  /** Editable profile field (not identity). */
  displayName: string;
  /** Editable preference (not identity). */
  locale: Locale;
  createdAt: ISODateString;
  /**
   * Optional profile fields (editable, non-authorizing). All optional so
   * previously-stored users remain valid (backward compatible); resolved with
   * defaults by ProfileService.
   */
  profile?: StudentProfile;
}

/** Number of questions a generated quiz should contain. */
export type QuizLength = 10 | 20;

/** Student-controlled preferences (Benim Alanım). Minimal PII by design. */
export interface StudyPreferences {
  quizLength: QuizLength;
  /** Preferred podcast recap length. */
  podcastLength: "short" | "medium";
  /** Larger text / higher contrast, etc. */
  largeText: boolean;
  reduceMotion: boolean;
}

export interface StudentProfile {
  /** Optional, student-provided. Not required; do not collect unnecessary PII. */
  school?: string;
  grade?: string;
  /** Avatar is a chosen color + initials (no photo upload required in MVP). */
  avatarColor?: string;
  preferences: StudyPreferences;
}

export const DEFAULT_STUDY_PREFERENCES: StudyPreferences = {
  quizLength: 10,
  podcastLength: "short",
  largeText: false,
  reduceMotion: false,
};

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
  // Audio is recorded and preserved, but automatic transcription is not yet
  // available (no transcription backend connected). We stop here rather than
  // fabricating a transcript; analysis resumes once a transcript exists.
  | "awaiting_transcription"
  // Audio is recorded, saved, and playable, but a transcription ATTEMPT failed
  // (e.g. backend/Transcribe error). The recording is NEVER removed; the
  // student can retry transcription. Distinct from "awaiting_transcription"
  // (no attempt yet) and "failed" (terminal).
  | "transcription_failed"
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
  /**
   * True when no automatic transcript is available yet (transcription backend
   * not connected). `text` is empty in this case — never fabricated. Set to
   * false once a real (or user-edited) transcript exists.
   */
  pending?: boolean;
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

// --- Server-persisted study materials (Phase 2) ----------------------------

/**
 * Lifecycle of a server-generated study set. Mirrors the backend
 * STUDY#<lessonId>#<sourceId> item's `status` field so the mobile UI can show
 * not-generated / generating / ready / failed states without guessing.
 */
export type StudyStatus = "generating" | "ready" | "failed";

/**
 * A key concept as returned by the grounded backend. Unlike the local
 * {@link Concept}, each artifact carries the index of the transcript chunk it
 * was grounded in (long-lesson map/reduce provenance).
 */
export interface ServerConcept {
  name: string;
  explanation: string;
  chunkIndex?: number | null;
}

export interface ServerFlashcard {
  front: string;
  back: string;
  chunkIndex?: number | null;
}

/**
 * A grounded multiple-choice question from the backend. The correct answer is
 * guaranteed by the backend to appear in the transcript (ungrounded questions
 * are dropped server-side, never fabricated).
 */
export interface ServerQuizQuestion {
  prompt: string;
  options: string[]; // exactly 4
  correctIndex: number; // 0..3
  explanation: string;
  topic?: string;
  chunkIndex?: number | null;
}

/**
 * The server-persisted, grounded study material for one lesson transcript
 * source (backend SK = STUDY#<lessonId>#<sourceId>).
 *
 * PERSISTENCE + PROVENANCE: survives restart/sign-out and loads on any device
 * for the same account WITHOUT another model call. Every item records which
 * lesson + source + transcript it was built from. `transcriptFingerprint` is a
 * content hash of the transcript at generation time; `stale` is computed by the
 * backend on read by comparing it to the CURRENT transcript, so the UI can
 * offer regeneration without silently spending a model call.
 *
 * GROUNDING: `provenance` is always "Kaynaklarından" ("from your sources") — the
 * content is extracted from the student's own transcript, never invented.
 */
export interface ServerStudySet {
  lessonId: Id;
  courseId: Id;
  sourceId: Id;
  status: StudyStatus;
  /** Present once `status === "ready"`. */
  summary?: string;
  concepts?: ServerConcept[];
  flashcards?: ServerFlashcard[];
  quiz?: ServerQuizQuestion[];
  /** Number of transcript chunks the material was mapped/reduced over. */
  chunkCount?: number;
  /** Content hash of the transcript the material was generated from. */
  transcriptFingerprint?: string;
  /** True when the current transcript no longer matches `transcriptFingerprint`. */
  stale?: boolean;
  /** Always "Kaynaklarından" — grounded in the student's own material. */
  provenance?: string;
  /** Which provider produced it (e.g. "local-grounded-v2" or "bedrock"). */
  provider?: string;
  language?: Locale;
  schemaVersion?: number;
  /** Error code when `status === "failed"` (retryable). */
  error?: string;
  createdAt: ISODateString;
  updatedAt?: ISODateString;
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
  /** Original audio for a voice note (local URI now; S3 key later). Preserved. */
  audioUri?: string;
  /**
   * True when a voice note's audio has no automatic transcript yet
   * (transcription backend not connected). `body` holds whatever the student
   * typed — never fabricated transcript text.
   */
  transcriptionPending?: boolean;
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
  total: number; // out of (10 or 20)
  percentage: number;
  weakTopics: string[];
}

// --- Progress / history (İlerlemem) ----------------------------------------

/** A persisted quiz attempt, scoped to a user (and lesson/course). */
export interface QuizAttempt {
  id: Id;
  userId: Id;
  lessonId?: Id;
  courseId?: Id;
  score: number;
  total: number;
  percentage: number;
  weakTopics: string[];
  createdAt: ISODateString;
}

/** A persisted flashcard-study event (one card marked known/review). */
export interface FlashcardStudyEvent {
  id: Id;
  userId: Id;
  lessonId?: Id;
  cardId: Id;
  state: "known" | "review";
  createdAt: ISODateString;
}

/**
 * Derived, informational progress. Purely counts/history of the student's own
 * activity — no invented learning-performance claims.
 */
export interface ProgressSummary {
  coursesCount: number;
  lessonsReady: number; // lessons whose study set is ready
  flashcardsStudied: number;
  quizAttempts: QuizAttempt[]; // most-recent first
  averageQuizPercentage: number | null; // null when no attempts
  /** Topics the student's incorrect answers touched, most frequent first. */
  difficultConcepts: string[];
}
