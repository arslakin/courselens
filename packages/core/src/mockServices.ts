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
  Id,
  Lesson,
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
import type {
  AuthService,
  ChatMode,
  ChatResponse,
  ChatService,
  CourseService,
  FlashcardService,
  LessonService,
  NotesService,
  PodcastService,
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
import {
  MOCK_TRANSCRIPT_TR,
  makeMockStudySet,
  mockId,
} from "./mockContent";

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

export class MockTranscriptionService implements TranscriptionService {
  async transcribeLesson(lessonId: Id, _audioUri: string): Promise<Transcript> {
    await delay(700); // simulate async transcription
    return {
      id: mockId("tr"),
      lessonId,
      text: MOCK_TRANSCRIPT_TR,
      language: "tr-TR",
      confidenceAvg: 0.93,
      editedByUser: false,
    };
  }
  async transcribeVoiceNote(_audioUri: string): Promise<string> {
    await delay(500);
    return "Hoca bu konunun sınavda önemli olduğunu söyledi.";
  }
}

export class MockStudyService implements StudyService {
  async analyze(_lessonId: Id, _transcript: Transcript): Promise<StudySet> {
    await delay(800); // simulate Bedrock analysis
    return makeMockStudySet();
  }
}

export class MockQuizService implements QuizService {
  async grade(quiz: Quiz, selections: Array<0 | 1 | 2 | 3>): Promise<QuizResult> {
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
    return {
      quizId: quiz.id,
      answers,
      score,
      total,
      percentage: Math.round((score / total) * 100),
      weakTopics,
    };
  }
}

export class MockFlashcardService implements FlashcardService {
  async mark(_lessonId: Id, _cardId: Id, _state: Flashcard["state"]): Promise<void> {
    // In mock mode the card state is held in lesson.study and persisted by the
    // lesson service when the screen saves; nothing extra to do here.
    await delay(30);
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
    opts?: { title?: string; courseId?: Id; lessonId?: Id; kind?: Note["kind"] }
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
  async generate(_lessonId: Id, study: StudySet): Promise<Podcast> {
    await delay(300);
    return (
      study.podcast ?? {
        id: mockId("pod"),
        script: "Bu dersin kısa sesli özeti (demo).",
        durationSec: 60,
      }
    );
  }
}

export class MockChatService implements ChatService {
  constructor(private store: JsonStore) {}
  private key(lessonId: Id) {
    return `${K.chats}:${lessonId}`;
  }
  async history(lessonId: Id): Promise<ChatMessage[]> {
    return this.store.read<ChatMessage[]>(this.key(lessonId), []);
  }
  async ask(lessonId: Id, question: string, mode: ChatMode): Promise<ChatResponse> {
    await delay(400);
    const history = await this.history(lessonId);
    const userMsg: ChatMessage = {
      id: mockId("msg"),
      lessonId,
      role: "user",
      text: question,
      createdAt: now(),
    };

    let assistant: ChatMessage;
    if (mode === "external") {
      // External research is NOT implemented in this phase. Never mix it into
      // grounded answers; return a clear, separate notice.
      assistant = {
        id: mockId("msg"),
        lessonId,
        role: "assistant",
        text: "Dış kaynak araması bu sürümde henüz aktif değil.",
        provenance: "external",
        createdAt: now(),
      };
    } else {
      // Grounded mock: answer only if the question relates to known material.
      const grounded = /fotosentez|kloroplast|klorofil|calvin|oksijen|glikoz|ışık/i.test(
        question
      );
      assistant = grounded
        ? {
            id: mockId("msg"),
            lessonId,
            role: "assistant",
            text:
              "Kaynaklarına göre: fotosentez, bitkilerin ışık enerjisini " +
              "kullanarak kloroplastta glikoz ve oksijen üretmesidir. İki evre " +
              "vardır: ışığa bağımlı reaksiyonlar ve Calvin döngüsü.",
            provenance: "grounded",
            createdAt: now(),
          }
        : {
            id: mockId("msg"),
            lessonId,
            role: "assistant",
            text: "Bu bilgi kaynaklarında yer almıyor.",
            provenance: "not_found",
            createdAt: now(),
          };
    }

    await this.store.write(this.key(lessonId), [...history, userMsg, assistant]);
    return { message: assistant, provenance: assistant.provenance ?? "grounded" };
  }
}

/** Builds the full service set over a storage backend. */
export function createMockServices(kv: KeyValueStore = new MemoryStore()): Services {
  const store = new JsonStore(kv);
  return {
    auth: new MockAuthService(store),
    courses: new MockCourseService(store),
    lessons: new MockLessonService(store),
    sources: new MockSourceService(store),
    uploads: new MockUploadService(),
    recording: new MockRecordingService(),
    transcription: new MockTranscriptionService(),
    study: new MockStudyService(),
    quiz: new MockQuizService(),
    flashcards: new MockFlashcardService(),
    notes: new MockNotesService(store),
    podcast: new MockPodcastService(),
    chat: new MockChatService(store),
  };
}
