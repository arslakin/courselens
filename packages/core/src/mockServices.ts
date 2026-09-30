/**
 * Local mock implementations of every RojAnda service contract.
 *
 * - No network, no AWS. All data persists in an injected KeyValueStore.
 * - Simulates async latency so the UI exercises real loading states.
 * - Designed to be swapped 1:1 for AWS-backed implementations later
 *   (Cognito / API Gateway+Lambda / S3 / Transcribe / Bedrock / Polly /
 *   DynamoDB) without changing screens.
 */
import type {
  ChatMessage,
  Course,
  Flashcard,
  FlashcardStudyEvent,
  Id,
  Lesson,
  Note,
  Podcast,
  ProgressSummary,
  Quiz,
  QuizAttempt,
  QuizResult,
  Source,
  SourceKind,
  StudentProfile,
  StudySet,
  Transcript,
  User,
} from "@rojanda/types";
import { DEFAULT_STUDY_PREFERENCES } from "@rojanda/types";
import type {
  AnalysisBackend,
  AuthService,
  ChatMode,
  ChatResponse,
  ChatService,
  CourseService,
  FlashcardService,
  LessonService,
  NotesService,
  PodcastService,
  ProfileService,
  ProgressService,
  QuizService,
  RecordingHandle,
  RecordingService,
  Services,
  SourceService,
  StudyService,
  TranscriptionService,
  UploadService,
} from "@rojanda/api";
import { JsonStore, MemoryStore, type KeyValueStore } from "./storage";
import { MOCK_TRANSCRIPT_TR, mockId } from "./mockContent";
import { LocalAnalysisBackend } from "./localAnalysis";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

/** Storage keys. */
const K = {
  user: "user",
  courses: "courses",
  lessons: "lessons",
  sources: "sources",
  notes: "notes",
  chats: "chats",
  quizAttempts: "quizAttempts",
  flashcardEvents: "flashcardEvents",
};

export class MockAuthService implements AuthService {
  constructor(private store: JsonStore) {}
  async getCurrentUser(): Promise<User | null> {
    return this.store.read<User | null>(K.user, null);
  }
  async signIn(email: string, displayName = "Öğrenci"): Promise<User> {
    await delay(150);
    const user: User = {
      id: mockId("user"),
      email,
      displayName,
      locale: "tr",
      createdAt: now(),
    };
    await this.store.write(K.user, user);
    return user;
  }
  async signOut(): Promise<void> {
    await this.store.write(K.user, null);
  }
}

export class MockCourseService implements CourseService {
  constructor(private store: JsonStore) {}
  private all() {
    return this.store.read<Course[]>(K.courses, []);
  }
  async list(userId: Id): Promise<Course[]> {
    return (await this.all()).filter((c) => c.userId === userId);
  }
  async get(courseId: Id): Promise<Course | null> {
    return (await this.all()).find((c) => c.id === courseId) ?? null;
  }
  async create(userId: Id, title: string, color?: string): Promise<Course> {
    await delay(120);
    const course: Course = { id: mockId("course"), userId, title, color, createdAt: now() };
    const list = await this.all();
    await this.store.write(K.courses, [course, ...list]);
    return course;
  }
  async rename(courseId: Id, title: string): Promise<Course> {
    const list = await this.all();
    const next = list.map((c) => (c.id === courseId ? { ...c, title } : c));
    await this.store.write(K.courses, next);
    return next.find((c) => c.id === courseId) as Course;
  }
  async remove(courseId: Id): Promise<void> {
    const list = await this.all();
    await this.store.write(K.courses, list.filter((c) => c.id !== courseId));
  }
}

export class MockLessonService implements LessonService {
  constructor(private store: JsonStore) {}
  private all() {
    return this.store.read<Lesson[]>(K.lessons, []);
  }
  private save(list: Lesson[]) {
    return this.store.write(K.lessons, list);
  }
  async listByCourse(courseId: Id): Promise<Lesson[]> {
    return (await this.all()).filter((l) => l.courseId === courseId);
  }
  async listRecent(userId: Id, limit = 5): Promise<Lesson[]> {
    return (await this.all())
      .filter((l) => l.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  async get(lessonId: Id): Promise<Lesson | null> {
    return (await this.all()).find((l) => l.id === lessonId) ?? null;
  }
  async create(courseId: Id, userId: Id, title: string): Promise<Lesson> {
    const lesson: Lesson = {
      id: mockId("lesson"),
      courseId,
      userId,
      title,
      status: "draft",
      createdAt: now(),
    };
    await this.save([lesson, ...(await this.all())]);
    return lesson;
  }
  async update(lessonId: Id, patch: Partial<Lesson>): Promise<Lesson> {
    const list = await this.all();
    const next = list.map((l) => (l.id === lessonId ? { ...l, ...patch } : l));
    await this.save(next);
    return next.find((l) => l.id === lessonId) as Lesson;
  }
  async remove(lessonId: Id): Promise<void> {
    await this.save((await this.all()).filter((l) => l.id !== lessonId));
  }
}

export class MockSourceService implements SourceService {
  constructor(private store: JsonStore) {}
  private all() {
    return this.store.read<Source[]>(K.sources, []);
  }
  async listByLesson(lessonId: Id): Promise<Source[]> {
    return (await this.all()).filter((s) => s.lessonId === lessonId);
  }
  async add(
    lessonId: Id,
    userId: Id,
    kind: SourceKind,
    data: { uri?: string; mime?: string; extractedText?: string }
  ): Promise<Source> {
    const source: Source = {
      id: mockId("src"),
      lessonId,
      userId,
      kind,
      origin: "own",
      createdAt: now(),
      ...data,
    };
    await this.store.write(K.sources, [source, ...(await this.all())]);
    return source;
  }
}

export class MockUploadService implements UploadService {
  async createUpload(lessonId: Id, _kind: SourceKind, _mime: string) {
    await delay(100);
    // In real impl this returns an S3 presigned PUT URL.
    return { uploadTarget: `mock://upload/${lessonId}`, sourceId: mockId("src") };
  }
  async completeUpload(_sourceId: Id, _localUri: string): Promise<void> {
    await delay(100);
  }
}

class MockRecordingHandle implements RecordingHandle {
  private startedAt = Date.now();
  private pausedMs = 0;
  private pauseStart: number | null = null;
  async pause() {
    if (this.pauseStart == null) this.pauseStart = Date.now();
  }
  async resume() {
    if (this.pauseStart != null) {
      this.pausedMs += Date.now() - this.pauseStart;
      this.pauseStart = null;
    }
  }
  async stop() {
    const elapsed = Date.now() - this.startedAt - this.pausedMs;
    return { uri: `mock://recording/${mockId("rec")}`, durationSec: Math.max(1, Math.round(elapsed / 1000)) };
  }
}

export class MockRecordingService implements RecordingService {
  async start(): Promise<RecordingHandle> {
    return new MockRecordingHandle();
  }
}

/**
 * Honest, default transcription: no transcription backend is connected, so this
 * returns a clearly PENDING transcript (empty text) rather than fabricating
 * content. The audio is still preserved and playable; the student can type the
 * text, and real transcription can fill it in later. This is what the shipping
 * app uses today.
 */
export class PendingTranscriptionService implements TranscriptionService {
  async transcribeLesson(lessonId: Id, _audioUri: string): Promise<Transcript> {
    return {
      id: mockId("tr"),
      lessonId,
      text: "",
      language: "tr-TR",
      editedByUser: false,
      pending: true,
    };
  }
  async transcribeVoiceNote(_audioUri: string): Promise<string | null> {
    // No automatic transcription available yet — never fabricate text.
    return null;
  }
}

/**
 * Deterministic transcription used ONLY in tests to exercise the full
 * record -> transcribe -> analyze pipeline with known text. Not wired into the
 * app (which uses PendingTranscriptionService) so we never ship fabricated
 * transcripts.
 */
export class MockTranscriptionService implements TranscriptionService {
  async transcribeLesson(lessonId: Id, _audioUri: string): Promise<Transcript> {
    await delay(50);
    return {
      id: mockId("tr"),
      lessonId,
      text: MOCK_TRANSCRIPT_TR,
      language: "tr-TR",
      confidenceAvg: 0.93,
      editedByUser: false,
      pending: false,
    };
  }
  async transcribeVoiceNote(_audioUri: string): Promise<string | null> {
    await delay(50);
    return "Hoca bu konunun sınavda önemli olduğunu söyledi.";
  }
}

export class MockStudyService implements StudyService {
  constructor(private backend: AnalysisBackend, private store: JsonStore) {}
  async analyze(_lessonId: Id, transcript: Transcript): Promise<StudySet> {
    // Grounded in the actual transcript/source text. Quiz length follows the
    // signed-in student's preference (defaults to 10).
    const user = await this.store.read<User | null>(K.user, null);
    const quizLength = user?.profile?.preferences?.quizLength ?? 10;
    return this.backend.analyze(transcript.text, { language: "tr", quizLength });
  }
}

export class MockQuizService implements QuizService {
  constructor(private store: JsonStore) {}
  async grade(
    quiz: Quiz,
    selections: Array<0 | 1 | 2 | 3>,
    ctx?: { userId?: Id; lessonId?: Id; courseId?: Id }
  ): Promise<QuizResult> {
    const answers = quiz.questions.map((q, i) => ({
      questionId: q.id,
      selectedIndex: selections[i],
      correct: selections[i] === q.correctIndex,
    }));
    const score = answers.filter((a) => a.correct).length;
    const total = quiz.questions.length;
    const weakTopics = Array.from(
      new Set(
        quiz.questions
          .filter((q, i) => selections[i] !== q.correctIndex && q.topic)
          .map((q) => q.topic as string)
      )
    );
    const result: QuizResult = {
      quizId: quiz.id,
      answers,
      score,
      total,
      percentage: Math.round((score / total) * 100),
      weakTopics,
    };

    // Persist an attempt to the user's own history (İlerlemem). Scoped by
    // userId so histories never mix between users.
    if (ctx?.userId) {
      const attempt: QuizAttempt = {
        id: mockId("qa"),
        userId: ctx.userId,
        lessonId: ctx.lessonId,
        courseId: ctx.courseId,
        score,
        total,
        percentage: result.percentage,
        weakTopics,
        createdAt: now(),
      };
      const all = await this.store.read<QuizAttempt[]>(K.quizAttempts, []);
      await this.store.write(K.quizAttempts, [attempt, ...all]);
    }
    return result;
  }
}

export class MockFlashcardService implements FlashcardService {
  constructor(private store: JsonStore) {}
  async mark(
    lessonId: Id,
    cardId: Id,
    state: Flashcard["state"],
    userId?: Id
  ): Promise<void> {
    await delay(20);
    if (userId && (state === "known" || state === "review")) {
      const event: FlashcardStudyEvent = {
        id: mockId("fe"),
        userId,
        lessonId,
        cardId,
        state,
        createdAt: now(),
      };
      const all = await this.store.read<FlashcardStudyEvent[]>(K.flashcardEvents, []);
      await this.store.write(K.flashcardEvents, [event, ...all]);
    }
  }
}

export class MockProfileService implements ProfileService {
  constructor(private store: JsonStore) {}
  async get(_userId: Id): Promise<StudentProfile> {
    const user = await this.store.read<User | null>(K.user, null);
    const p = user?.profile;
    return {
      school: p?.school,
      grade: p?.grade,
      avatarColor: p?.avatarColor,
      preferences: { ...DEFAULT_STUDY_PREFERENCES, ...(p?.preferences ?? {}) },
    };
  }
  async update(userId: Id, patch: Partial<StudentProfile>): Promise<StudentProfile> {
    const current = await this.get(userId);
    const next: StudentProfile = {
      ...current,
      ...patch,
      preferences: { ...current.preferences, ...(patch.preferences ?? {}) },
    };
    const user = await this.store.read<User | null>(K.user, null);
    if (user) await this.store.write(K.user, { ...user, profile: next });
    return next;
  }
  async setDisplayName(_userId: Id, displayName: string): Promise<User> {
    const user = await this.store.read<User | null>(K.user, null);
    const next = { ...(user as User), displayName };
    await this.store.write(K.user, next);
    return next;
  }
}

export class MockProgressService implements ProgressService {
  constructor(private store: JsonStore) {}
  async summary(userId: Id): Promise<ProgressSummary> {
    const [courses, lessons, attempts, fcEvents] = await Promise.all([
      this.store.read<Course[]>(K.courses, []),
      this.store.read<Lesson[]>(K.lessons, []),
      this.store.read<QuizAttempt[]>(K.quizAttempts, []),
      this.store.read<FlashcardStudyEvent[]>(K.flashcardEvents, []),
    ]);
    // Everything scoped strictly to this user.
    const myCourses = courses.filter((c) => c.userId === userId);
    const myLessons = lessons.filter((l) => l.userId === userId);
    const myAttempts = attempts
      .filter((a) => a.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const myFc = fcEvents.filter((e) => e.userId === userId);

    const avg =
      myAttempts.length === 0
        ? null
        : Math.round(myAttempts.reduce((s, a) => s + a.percentage, 0) / myAttempts.length);

    // Difficult concepts = most frequent weak topics across attempts.
    const counts = new Map<string, number>();
    for (const a of myAttempts) for (const t of a.weakTopics) counts.set(t, (counts.get(t) ?? 0) + 1);
    const difficultConcepts = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);

    return {
      coursesCount: myCourses.length,
      lessonsReady: myLessons.filter((l) => l.status === "ready").length,
      flashcardsStudied: myFc.length,
      quizAttempts: myAttempts,
      averageQuizPercentage: avg,
      difficultConcepts,
    };
  }
}

export class MockNotesService implements NotesService {
  constructor(private store: JsonStore) {}
  private all() {
    return this.store.read<Note[]>(K.notes, []);
  }
  private save(list: Note[]) {
    return this.store.write(K.notes, list);
  }
  async list(userId: Id, filter?: { courseId?: Id; lessonId?: Id }): Promise<Note[]> {
    let list = (await this.all()).filter((n) => n.userId === userId);
    if (filter?.courseId) list = list.filter((n) => n.courseId === filter.courseId);
    if (filter?.lessonId) list = list.filter((n) => n.lessonId === filter.lessonId);
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async get(noteId: Id): Promise<Note | null> {
    return (await this.all()).find((n) => n.id === noteId) ?? null;
  }
  async create(
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
  ): Promise<Note> {
    const ts = now();
    const note: Note = {
      id: mockId("note"),
      userId,
      body,
      title: opts?.title,
      courseId: opts?.courseId,
      lessonId: opts?.lessonId,
      kind: opts?.kind ?? "typed",
      audioUri: opts?.audioUri,
      transcriptionPending: opts?.transcriptionPending,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.save([note, ...(await this.all())]);
    return note;
  }
  async update(noteId: Id, patch: Partial<Note>): Promise<Note> {
    const list = await this.all();
    const next = list.map((n) =>
      n.id === noteId ? { ...n, ...patch, updatedAt: now() } : n
    );
    await this.save(next);
    return next.find((n) => n.id === noteId) as Note;
  }
  async remove(noteId: Id): Promise<void> {
    await this.save((await this.all()).filter((n) => n.id !== noteId));
  }
}

export class MockPodcastService implements PodcastService {
  constructor(private backend: AnalysisBackend) {}
  async generate(_lessonId: Id, study: StudySet): Promise<Podcast> {
    // Script is grounded in the lesson's own study set (not generic chatter).
    const script = await this.backend.podcastScript(study, "tr");
    return {
      id: mockId("pod"),
      script,
      // Audio synthesis (Polly) is backend-only; left undefined until wired.
      durationSec: Math.max(45, Math.min(150, Math.round(script.length / 12))),
    };
  }
}

export class MockChatService implements ChatService {
  constructor(private store: JsonStore, private backend: AnalysisBackend) {}
  private key(lessonId: Id) {
    return `${K.chats}:${lessonId}`;
  }
  async history(lessonId: Id): Promise<ChatMessage[]> {
    return this.store.read<ChatMessage[]>(this.key(lessonId), []);
  }
  async ask(lessonId: Id, question: string, mode: ChatMode): Promise<ChatResponse> {
    const history = await this.history(lessonId);
    const userMsg: ChatMessage = {
      id: mockId("msg"),
      lessonId,
      role: "user",
      text: question,
      createdAt: now(),
    };

    // Build the grounding context from THIS lesson's own material only:
    // its sources' extracted text, the lesson transcript, and its notes.
    const lesson = (await this.store.read<Lesson[]>(K.lessons, [])).find((l) => l.id === lessonId);
    const sources = (await this.store.read<Source[]>(K.sources, [])).filter(
      (s) => s.lessonId === lessonId
    );
    const notes = (await this.store.read<Note[]>(K.notes, [])).filter((n) => n.lessonId === lessonId);
    const sourceTexts = sources.map((s) => s.extractedText ?? "").filter(Boolean);
    // Transcript source (kind=recording) text doubles as transcript.
    const transcript = sources.find((s) => s.kind === "recording")?.extractedText;
    // Also include the generated summary as supporting context if present.
    if (lesson?.study?.summary) sourceTexts.push(lesson.study.summary);

    const result = await this.backend.ask(
      { sources: sourceTexts, transcript, notes: notes.map((n) => n.body) },
      question,
      mode
    );

    const assistant: ChatMessage = {
      id: mockId("msg"),
      lessonId,
      role: "assistant",
      text: result.answer,
      provenance: result.provenance,
      createdAt: now(),
    };
    await this.store.write(this.key(lessonId), [...history, userMsg, assistant]);
    return { message: assistant, provenance: result.provenance };
  }
}

/** Clears all locally-stored RojAnda data (courses, lessons, sources, notes,
 *  chats). Used by Settings → "delete all local data". */
export async function clearAllLocalData(kv: KeyValueStore): Promise<void> {
  const store = new JsonStore(kv);
  await Promise.all([
    store.write(K.courses, []),
    store.write(K.lessons, []),
    store.write(K.sources, []),
    store.write(K.notes, []),
    store.write(K.quizAttempts, []),
    store.write(K.flashcardEvents, []),
  ]);
}

/**
 * Builds the full service set over a storage backend.
 *
 * @param kv      persistence (AsyncStorage on device, MemoryStore in tests)
 * @param backend the AnalysisBackend (defaults to the local, offline, grounded
 *                implementation; swap for RemoteAnalysisBackend when the
 *                RojAnda backend is deployed — no screen changes required)
 */
/**
 * Optional overrides let the platform layer inject real, device-backed
 * implementations (e.g. the mobile app supplies an expo-av RecordingService)
 * while everything else stays on the local in-memory implementations. Screens
 * and the pipeline depend only on the interfaces, so nothing else changes.
 */
export interface ServiceOverrides {
  recording?: RecordingService;
  transcription?: TranscriptionService;
}

export function createMockServices(
  kv: KeyValueStore = new MemoryStore(),
  backend: AnalysisBackend = new LocalAnalysisBackend(),
  overrides: ServiceOverrides = {}
): Services {
  const store = new JsonStore(kv);
  return {
    auth: new MockAuthService(store),
    profile: new MockProfileService(store),
    progress: new MockProgressService(store),
    courses: new MockCourseService(store),
    lessons: new MockLessonService(store),
    sources: new MockSourceService(store),
    uploads: new MockUploadService(),
    // No real device recorder by default (tests/web). The mobile app injects
    // an expo-av RecordingService. Transcription is honest/pending by default.
    recording: overrides.recording ?? new MockRecordingService(),
    transcription: overrides.transcription ?? new PendingTranscriptionService(),
    study: new MockStudyService(backend, store),
    quiz: new MockQuizService(store),
    flashcards: new MockFlashcardService(store),
    notes: new MockNotesService(store),
    podcast: new MockPodcastService(backend),
    chat: new MockChatService(store, backend),
  };
}
