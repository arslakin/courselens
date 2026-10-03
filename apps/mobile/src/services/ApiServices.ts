/**
 * API-backed repositories for profile / course / lesson (Phase 1C).
 *
 * These implement the SAME service interfaces the screens already use, so no
 * screen rewrites are needed. Every call goes through the authenticated
 * ApiClient (Bearer JWT); the backend derives the owner from the verified `sub`.
 * The `userId` arguments in the interfaces are LOCAL/domain references and are
 * intentionally IGNORED here — the client never sends an ownerId as
 * authorization (the backend would ignore it anyway).
 */
import type { Course, Id, Lesson, ServerStudySet, StudentProfile, User } from "@rojanda/types";
import type { CourseService, LessonService, ProfileService, ServerStudyService } from "@rojanda/api";
import type { ApiClient } from "./apiClient";

// --- Profile ----------------------------------------------------------------
export class ApiProfileService implements ProfileService {
  constructor(private api: ApiClient) {}

  async get(_userId: Id): Promise<StudentProfile> {
    const p = await this.api.get<any>("/profile");
    return toProfile(p);
  }
  async update(_userId: Id, patch: Partial<StudentProfile>): Promise<StudentProfile> {
    const p = await this.api.put<any>("/profile", patch);
    return toProfile(p);
  }
  async setDisplayName(_userId: Id, displayName: string): Promise<User> {
    const p = await this.api.put<any>("/profile", { displayName });
    return {
      id: "", // identity comes from the session, not this response
      email: p.email ?? "",
      displayName: p.displayName ?? displayName,
      locale: p.locale ?? "tr",
      createdAt: p.createdAt ?? new Date().toISOString(),
    };
  }
}

function toProfile(p: any): StudentProfile {
  return {
    school: p?.school,
    grade: p?.grade,
    avatarColor: p?.avatarColor,
    preferences: p?.preferences ?? {
      quizLength: 10,
      podcastLength: "short",
      largeText: false,
      reduceMotion: false,
    },
  };
}

// --- Courses ----------------------------------------------------------------
export class ApiCourseService implements CourseService {
  constructor(private api: ApiClient) {}

  async list(_userId: Id): Promise<Course[]> {
    const r = await this.api.get<{ courses: any[] }>("/courses");
    return (r.courses ?? []).map(toCourse);
  }
  async get(courseId: Id): Promise<Course | null> {
    try {
      return toCourse(await this.api.get<any>(`/courses/${encodeURIComponent(courseId)}`));
    } catch {
      return null;
    }
  }
  async create(_userId: Id, title: string, color?: string): Promise<Course> {
    return toCourse(await this.api.post<any>("/courses", { title, color }));
  }
  async rename(courseId: Id, title: string): Promise<Course> {
    return toCourse(await this.api.put<any>(`/courses/${encodeURIComponent(courseId)}`, { title }));
  }
  async remove(courseId: Id): Promise<void> {
    await this.api.del(`/courses/${encodeURIComponent(courseId)}`);
  }
}

function toCourse(c: any): Course {
  return { id: c.courseId, userId: "", title: c.title, color: c.color, createdAt: c.createdAt };
}

// --- Lessons ----------------------------------------------------------------
/**
 * The backend nests lessons under courses. The client interface addresses some
 * lesson ops by lessonId alone, so this repo caches lessonId -> courseId as it
 * sees lessons (from listByCourse / create). listRecent aggregates across the
 * student's courses.
 */
export class ApiLessonService implements LessonService {
  private courseOf = new Map<string, string>();
  constructor(private api: ApiClient, private courses: ApiCourseService) {}

  private remember(courseId: string, lessons: Lesson[]) {
    for (const l of lessons) this.courseOf.set(l.id, courseId);
  }

  async listByCourse(courseId: Id): Promise<Lesson[]> {
    const r = await this.api.get<{ lessons: any[] }>(`/courses/${encodeURIComponent(courseId)}/lessons`);
    const lessons = (r.lessons ?? []).map(toLesson);
    this.remember(courseId, lessons);
    return lessons;
  }
  async listRecent(userId: Id, limit = 5): Promise<Lesson[]> {
    const courses = await this.courses.list(userId);
    const all: Lesson[] = [];
    for (const c of courses) all.push(...(await this.listByCourse(c.id)));
    all.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return all.slice(0, limit);
  }
  async get(lessonId: Id): Promise<Lesson | null> {
    const courseId = this.courseOf.get(lessonId);
    if (!courseId) return null; // must be discovered via listByCourse first
    try {
      const l = await this.api.get<any>(
        `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`
      );
      return toLesson(l);
    } catch {
      return null;
    }
  }
  async create(courseId: Id, _userId: Id, title: string): Promise<Lesson> {
    const l = toLesson(await this.api.post<any>(`/courses/${encodeURIComponent(courseId)}/lessons`, { title }));
    this.courseOf.set(l.id, courseId);
    return l;
  }
  async update(lessonId: Id, patch: Partial<Lesson>): Promise<Lesson> {
    const courseId = this.courseOf.get(lessonId);
    if (!courseId) throw new Error("unknown-lesson-course");
    const l = await this.api.put<any>(
      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`,
      patch
    );
    return toLesson(l);
  }
  async remove(lessonId: Id): Promise<void> {
    const courseId = this.courseOf.get(lessonId);
    if (!courseId) return;
    await this.api.del(`/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`);
  }
}

// --- Transcripts (server-persisted; read-only on the client) ----------------
/**
 * A persisted lesson transcript as returned by
 * GET /courses/{courseId}/lessons/{lessonId}/transcripts. The backend never
 * exposes raw S3 keys here; text is only what Amazon Transcribe produced.
 */
export interface LessonTranscript {
  sourceId: string;
  text: string;
  language?: string;
  status?: string;
  durationSeconds?: number;
  createdAt?: string;
}

/**
 * Reads the authoritative, server-persisted transcripts for a lesson. This is
 * what makes a transcript visible after backend recovery or on another device,
 * where the local recording source has no extractedText.
 */
export class ApiTranscriptService {
  constructor(private api: ApiClient) {}

  async listByLesson(courseId: Id, lessonId: Id): Promise<LessonTranscript[]> {
    const r = await this.api.get<{ transcripts: any[] }>(
      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/transcripts`
    );
    return (r.transcripts ?? []).map(toTranscript);
  }
}

function toTranscript(t: any): LessonTranscript {
  return {
    sourceId: t?.sourceId ?? "",
    text: typeof t?.text === "string" ? t.text : "",
    language: t?.language,
    status: t?.status,
    durationSeconds: typeof t?.durationSeconds === "number" ? t.durationSeconds : undefined,
    createdAt: t?.createdAt,
  };
}

/**
 * Chooses the transcript text to show for a lesson: the newest READY
 * server-persisted transcript with real text, otherwise the local recording
 * source's text (offline/local mode), otherwise nothing. Never invents text.
 */
export function selectLessonTranscriptText(
  serverTranscripts: LessonTranscript[],
  localRecordingText?: string
): string | undefined {
  const usable = serverTranscripts
    .filter((t) => (t.status === undefined || t.status === "ready") && t.text.trim().length > 0)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  if (usable.length > 0) return usable[0].text;
  const local = localRecordingText?.trim();
  return local ? localRecordingText : undefined;
}

function toLesson(l: any): Lesson {
  return {
    id: l.lessonId,
    courseId: l.courseId,
    userId: "",
    title: l.title,
    status: l.status ?? "draft",
    durationSec: l.durationSec,
    createdAt: l.createdAt,
  };
}

// --- Study materials (server-persisted, grounded; Phase 2) ------------------
/**
 * Reads + generates the server-persisted grounded study materials for a lesson
 * (backend STUDY#<lessonId>#<sourceId>). `listByLesson` is read-only and never
 * triggers a model call; `generate` is idempotent on the backend (repeated taps
 * return the existing ready item). `force` is only used for an explicit
 * regenerate after the transcript changed. All content is grounded in the
 * student's own transcript — the client never fabricates study material.
 */
export class ApiStudyService implements ServerStudyService {
  constructor(private api: ApiClient) {}

  async listByLesson(courseId: Id, lessonId: Id): Promise<ServerStudySet[]> {
    const r = await this.api.get<{ study: any[] }>(
      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/study`
    );
    return (r.study ?? []).map(toServerStudy);
  }

  async generate(
    courseId: Id,
    lessonId: Id,
    opts?: { force?: boolean; sourceId?: Id }
  ): Promise<ServerStudySet> {
    const body: Record<string, unknown> = {};
    if (opts?.force) body.force = true;
    if (opts?.sourceId) body.sourceId = opts.sourceId;
    const s = await this.api.post<any>(
      `/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/study`,
      body
    );
    return toServerStudy(s);
  }
}

function toServerStudy(s: any): ServerStudySet {
  return {
    lessonId: s?.lessonId ?? "",
    courseId: s?.courseId ?? "",
    sourceId: s?.sourceId ?? "",
    status: s?.status ?? "generating",
    summary: typeof s?.summary === "string" ? s.summary : undefined,
    concepts: Array.isArray(s?.concepts) ? s.concepts : undefined,
    flashcards: Array.isArray(s?.flashcards) ? s.flashcards : undefined,
    quiz: Array.isArray(s?.quiz) ? s.quiz : undefined,
    chunkCount: typeof s?.chunkCount === "number" ? s.chunkCount : undefined,
    transcriptFingerprint: s?.transcriptFingerprint,
    stale: typeof s?.stale === "boolean" ? s.stale : undefined,
    provenance: s?.provenance,
    provider: s?.provider,
    language: s?.language,
    schemaVersion: typeof s?.schemaVersion === "number" ? s.schemaVersion : undefined,
    error: s?.error,
    createdAt: s?.createdAt ?? "",
    updatedAt: s?.updatedAt,
  };
}
