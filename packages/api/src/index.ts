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
  ProgressSummary,
  Quiz,
  QuizResult,
  ServerStudySet,
  Source,
  SourceKind,
  StudentProfile,
  StudySet,
  Transcript,
  User,
} from "@rojanda/types";

export interface AuthService {
  getCurrentUser(): Promise<User | null>;
  signIn(email: string, displayName?: string): Promise<User>;
  signOut(): Promise<void>;
}

/** Benim Alanım — the student's own profile + preferences. */
export interface ProfileService {
  /** Returns the profile with defaults applied (never null for a signed-in user). */
  get(userId: Id): Promise<StudentProfile>;
  update(userId: Id, patch: Partial<StudentProfile>): Promise<StudentProfile>;
  /** Update the display name on the account. */
  setDisplayName(userId: Id, displayName: string): Promise<User>;
}

/** İlerlemem — derived, informational progress for one user only. */
export interface ProgressService {
  summary(userId: Id): Promise<ProgressSummary>;
}

// --- Real-data analysis backend -------------------------------------------

export type SourceInputKind = "image" | "pdf" | "doc" | "txt" | "audio";

export interface ExtractResult {
  /** Plain text extracted from the source (OCR/parse/transcript). */
  text: string;
  /** True when extraction is a local placeholder (e.g. OCR unavailable in Go). */
  placeholder: boolean;
}

export interface AnalyzeOptions {
  language: "tr" | "en";
  quizLength: 10 | 20;
}

export interface AskContext {
  sources: string[]; // extracted text of the student's own materials
  transcript?: string;
  notes?: string[];
}

export type AskProvenance = "grounded" | "not_found" | "external";

export interface AskResult {
  answer: string;
  provenance: AskProvenance;
}

/**
 * AnalysisBackend — the single boundary for every AI step. The mobile client
 * depends only on this; a LocalAnalysisBackend runs it offline for dev/testing,
 * and a RemoteAnalysisBackend calls the RojAnda backend once deployed. All
 * analysis is grounded in the student's own provided text.
 */
export interface AnalysisBackend {
  /** Extract text from a captured source (OCR / document parse / transcript). */
  extract(kind: SourceInputKind, input: { uri?: string; text?: string }): Promise<ExtractResult>;
  /** Grounded study set (summary/concepts/explanations/flashcards/quiz) in the requested language. */
  analyze(text: string, opts: AnalyzeOptions): Promise<import("@rojanda/types").StudySet>;
  /** Grounded Q&A over the student's own context (or explicit external mode). */
  ask(ctx: AskContext, question: string, mode: "sources" | "external"): Promise<AskResult>;
  /** Turkish podcast script grounded in the material (audio synthesis is backend-only). */
  podcastScript(study: import("@rojanda/types").StudySet, language: "tr" | "en"): Promise<string>;
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
  /**
   * Attach/overwrite the extracted text of an existing source (e.g. once a
   * transcript arrives). Optional so lightweight implementations may omit it;
   * the pipeline degrades gracefully when absent.
   */
  updateText?(sourceId: Id, extractedText: string): Promise<void>;
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

/**
 * Speech-to-text. Until Amazon Transcribe (tr-TR) is connected via the RojAnda
 * backend, the implementation returns a clearly-labeled PENDING transcript
 * (empty text, `pending: true`) rather than fabricating content. When the
 * backend exists, swap in a real implementation without changing callers.
 */
/**
 * Ownership context a real, server-backed transcription implementation needs to
 * scope the upload/job to the authenticated owner's course + lesson. Optional
 * so local/mock implementations (which ignore it) keep the same call sites.
 */
export interface TranscriptionContext {
  courseId?: Id;
  /**
   * Retry semantics: first try to RESUME an existing transcription job for
   * this lesson's recording (poll it / fetch its completed transcript) and only
   * upload + start a new job when no usable job exists. Never re-uploads audio
   * that already has a usable job.
   */
  resumeExisting?: boolean;
}

export interface TranscriptionService {
  /**
   * Full lecture recording -> transcript (async in real impl).
   * `ctx.courseId` is required by the remote backend to authorize + scope the
   * upload to the owner's course+lesson; local/mock impls ignore it.
   */
  transcribeLesson(lessonId: Id, audioUri: string, ctx?: TranscriptionContext): Promise<Transcript>;
  /**
   * Short spoken note -> text. Returns `null` when automatic transcription is
   * not available yet (never fabricated); the student can type the text.
   */
  transcribeVoiceNote(audioUri: string, ctx?: TranscriptionContext & { lessonId?: Id }): Promise<string | null>;
}

/** Generates the grounded study set from a lesson's own material. */
export interface StudyService {
  analyze(lessonId: Id, transcript: Transcript): Promise<StudySet>;
}

/**
 * Server-persisted grounded study materials (Phase 2).
 *
 * The boundary between the mobile UI and the RojAnda backend's
 * STUDY#<lessonId>#<sourceId> items. This is DISTINCT from {@link StudyService}
 * (which produces an ephemeral local StudySet): materials here are generated by
 * the backend, grounded in a persisted transcript, stored server-side, and
 * loaded on any device for the same account WITHOUT another model call.
 *
 *  - `listByLesson` is read-only; it NEVER triggers generation and returns the
 *    stored items with the backend's computed `stale` flag.
 *  - `generate` is idempotent: repeated calls return the existing ready item
 *    (no duplicate model spend) unless `force` is set, which the UI uses only
 *    for an explicit "regenerate" after the transcript changed.
 */
export interface ServerStudyService {
  listByLesson(courseId: Id, lessonId: Id): Promise<ServerStudySet[]>;
  generate(courseId: Id, lessonId: Id, opts?: { force?: boolean; sourceId?: Id }): Promise<ServerStudySet>;
}

export interface QuizService {
  /**
   * Grades a completed attempt. When `userId` is provided, the attempt is
   * persisted to that user's quiz history (for İlerlemem). Grading itself is
   * pure; persistence is per-user so histories never mix.
   */
  grade(
    quiz: Quiz,
    selections: Array<0 | 1 | 2 | 3>,
    ctx?: { userId?: Id; lessonId?: Id; courseId?: Id }
  ): Promise<QuizResult>;
}

export interface FlashcardService {
  /**
   * Persists the learner-marked state of a card ("known"/"review") and records
   * a study event for the given user (for İlerlemem).
   */
  mark(
    lessonId: Id,
    cardId: Id,
    state: Flashcard["state"],
    userId?: Id
  ): Promise<void>;
}

export interface NotesService {
  list(userId: Id, filter?: { courseId?: Id; lessonId?: Id }): Promise<Note[]>;
  get(noteId: Id): Promise<Note | null>;
  create(
    userId: Id,
    body: string,
    opts?: {
      title?: string;
      courseId?: Id;
      lessonId?: Id;
      kind?: Note["kind"];
      audioUri?: string;
      transcriptionPending?: boolean;
    }
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
  profile: ProfileService;
  progress: ProgressService;
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
