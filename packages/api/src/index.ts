/**
 * RojAnda service contracts.
 *
 * These interfaces are the boundary between the UI and any implementation.
 * Today they are backed by local mock implementations (@rojanda/core); later
 * each can be swapped for an AWS-backed implementation (Cognito, API Gateway +
 * Lambda, S3, Transcribe, Bedrock, Polly, DynamoDB) WITHOUT changing screens.
 *
 * Screens must depend only on these interfaces, never on a concrete impl.
 */
import type {
  ChatMessage,
  ChatProvenance,
  Course,
  Flashcard,
  Id,
  Lesson,
  Locale,
  Note,
  Podcast,
  Quiz,
  QuizResult,
  Source,
  SourceKind,
  StudySet,
  Transcript,
  User,
} from "@rojanda/types";

export interface AuthService {
  getCurrentUser(): Promise<User | null>;
  signIn(email: string, displayName?: string): Promise<User>;
  signOut(): Promise<void>;
}

export interface CourseService {
  list(userId: Id): Promise<Course[]>;
  get(courseId: Id): Promise<Course | null>;
  create(userId: Id, title: string, color?: string): Promise<Course>;
  rename(courseId: Id, title: string): Promise<Course>;
  remove(courseId: Id): Promise<void>;
}

export interface LessonService {
  listByCourse(courseId: Id): Promise<Lesson[]>;
  listRecent(userId: Id, limit?: number): Promise<Lesson[]>;
  get(lessonId: Id): Promise<Lesson | null>;
  create(courseId: Id, userId: Id, title: string): Promise<Lesson>;
  update(lessonId: Id, patch: Partial<Lesson>): Promise<Lesson>;
  remove(lessonId: Id): Promise<void>;
}

export interface SourceService {
  listByLesson(lessonId: Id): Promise<Source[]>;
  add(
    lessonId: Id,
    userId: Id,
    kind: SourceKind,
    data: { uri?: string; mime?: string; extractedText?: string }
  ): Promise<Source>;
}

/** Requests a place to store a binary (S3 presigned PUT later; local now). */
export interface UploadService {
  createUpload(
    lessonId: Id,
    kind: SourceKind,
    mime: string
  ): Promise<{ uploadTarget: string; sourceId: Id }>;
  /** In mock mode, just records that the "upload" completed. */
  completeUpload(sourceId: Id, localUri: string): Promise<void>;
}

export interface RecordingHandle {
  pause(): Promise<void>;
  resume(): Promise<void>;
  /** Stops recording and returns a local audio URI + duration. */
  stop(): Promise<{ uri: string; durationSec: number }>;
}

export interface RecordingService {
  start(): Promise<RecordingHandle>;
}

/** Speech-to-text. Mock now; Amazon Transcribe (tr-TR) later. */
export interface TranscriptionService {
  /** Full lecture recording -> transcript (async in real impl). */
  transcribeLesson(lessonId: Id, audioUri: string): Promise<Transcript>;
  /** Short spoken note -> text (used by Sesli Not). */
  transcribeVoiceNote(audioUri: string): Promise<string>;
}

/** Generates the grounded study set from a lesson's own material. */
export interface StudyService {
  analyze(lessonId: Id, transcript: Transcript): Promise<StudySet>;
}

export interface QuizService {
  /** Grades a completed attempt (answers already collected in the UI). */
  grade(quiz: Quiz, selections: Array<0 | 1 | 2 | 3>): Promise<QuizResult>;
}

export interface FlashcardService {
  /** Persists the learner-marked state of a card ("known"/"review"). */
  mark(lessonId: Id, cardId: Id, state: Flashcard["state"]): Promise<void>;
}

export interface NotesService {
  list(userId: Id, filter?: { courseId?: Id; lessonId?: Id }): Promise<Note[]>;
  get(noteId: Id): Promise<Note | null>;
  create(
    userId: Id,
    body: string,
    opts?: { title?: string; courseId?: Id; lessonId?: Id; kind?: Note["kind"] }
  ): Promise<Note>;
  update(noteId: Id, patch: Partial<Note>): Promise<Note>;
  remove(noteId: Id): Promise<void>;
}

export interface PodcastService {
  /** Builds a Turkish recap (script now; Polly audio later). */
  generate(lessonId: Id, study: StudySet): Promise<Podcast>;
}

export type ChatMode = "sources" | "external";

export interface ChatResponse {
  message: ChatMessage;
  provenance: ChatProvenance;
}

/**
 * Grounded chat. Default mode "sources" answers ONLY from the lesson's own
 * material; if the answer isn't present it returns provenance "not_found".
 * Mode "external" is the explicit "Dış Kaynaklarda Ara" path — NOT implemented
 * in this phase; the interface exists so external results can later be returned
 * separately and clearly labeled, never mixed into grounded answers.
 */
export interface ChatService {
  history(lessonId: Id): Promise<ChatMessage[]>;
  ask(lessonId: Id, question: string, mode: ChatMode): Promise<ChatResponse>;
}

/** The full set of services the app depends on. */
export interface Services {
  auth: AuthService;
  courses: CourseService;
  lessons: LessonService;
  sources: SourceService;
  uploads: UploadService;
  recording: RecordingService;
  transcription: TranscriptionService;
  study: StudyService;
  quiz: QuizService;
  flashcards: FlashcardService;
  notes: NotesService;
  podcast: PodcastService;
  chat: ChatService;
}

export type { Locale };
