import {
  MemoryStore,
  MockTranscriptionService,
  clearAllLocalData,
  createMockServices,
  makeMockQuiz,
  processRecordedLesson,
} from "./index";

/**
 * Helper: services with the DETERMINISTIC transcription override so the full
 * record -> transcribe -> analyze pipeline reaches `ready` in tests. The app
 * itself uses the honest/pending transcription (no fabricated transcripts).
 */
const withMockTranscription = (kv?: MemoryStore) =>
  createMockServices(kv ?? new MemoryStore(), undefined, {
    transcription: new MockTranscriptionService(),
  });

describe("MockCourseService + LessonService", () => {
  it("creates courses and lessons scoped to a user", async () => {
    const s = createMockServices(new MemoryStore());
    const user = await s.auth.signIn("ogrenci@example.com");
    const course = await s.courses.create(user.id, "Biyoloji");

    expect((await s.courses.list(user.id)).length).toBe(1);

    const lesson = await s.lessons.create(course.id, user.id, "Fotosentez");
    expect(lesson.status).toBe("draft");
    expect((await s.lessons.listByCourse(course.id)).length).toBe(1);
    expect((await s.lessons.listRecent(user.id)).length).toBe(1);
  });
});

describe("QuizService.grade", () => {
  it("scores a 10-question quiz and reports weak topics", async () => {
    const s = createMockServices();
    const quiz = makeMockQuiz();
    expect(quiz.questions.length).toBe(10);
    // Answer all correctly except the first.
    const selections = quiz.questions.map((q, i) =>
      i === 0 ? (((q.correctIndex + 1) % 4) as 0 | 1 | 2 | 3) : q.correctIndex
    );
    const result = await s.quiz.grade(quiz, selections);
    expect(result.total).toBe(10);
    expect(result.score).toBe(9);
    expect(result.percentage).toBe(90);
    expect(result.weakTopics.length).toBeGreaterThan(0);
  });

  it("every question has exactly one correct A-D answer", () => {
    const quiz = makeMockQuiz();
    for (const q of quiz.questions) {
      expect(q.options.length).toBe(4);
      expect(q.correctIndex).toBeGreaterThanOrEqual(0);
      expect(q.correctIndex).toBeLessThanOrEqual(3);
    }
  });
});

describe("NotesService", () => {
  it("creates, edits, associates, and deletes notes", async () => {
    const s = createMockServices();
    const user = await s.auth.signIn("a@b.co");
    const course = await s.courses.create(user.id, "Tarih");
    const note = await s.notes.create(user.id, "İlk not", {
      courseId: course.id,
      title: "Başlık",
    });
    expect(note.courseId).toBe(course.id);

    const edited = await s.notes.update(note.id, { body: "Güncellendi" });
    expect(edited.body).toBe("Güncellendi");
    expect((await s.notes.list(user.id, { courseId: course.id })).length).toBe(1);

    await s.notes.remove(note.id);
    expect((await s.notes.list(user.id)).length).toBe(0);
  });
});

describe("ChatService grounding (real, from the lesson's own sources)", () => {
  it("answers from sources, returns not_found otherwise, and never mixes external", async () => {
    const s = createMockServices();
    const user = await s.auth.signIn("a@x.co");
    const course = await s.courses.create(user.id, "Biyoloji");
    const lesson = await s.lessons.create(course.id, user.id, "Fotosentez");
    // Real grounding material: attach a source with actual text to this lesson.
    await s.sources.add(lesson.id, user.id, "txt", {
      extractedText:
        "Fotosentez, bitkilerin ışık enerjisini kullanarak kloroplastta glikoz üretmesidir.",
    });

    const grounded = await s.chat.ask(lesson.id, "Fotosentez nedir?", "sources");
    expect(grounded.provenance).toBe("grounded");
    expect(grounded.message.text).toContain("Kaynaklarından");

    // A question with no support in the lesson's material -> not_found.
    const missing = await s.chat.ask(lesson.id, "Osmanlı padişahları kimlerdir?", "sources");
    expect(missing.provenance).toBe("not_found");
    expect(missing.message.text).toContain("kaynaklarında yer almıyor");

    const external = await s.chat.ask(lesson.id, "herhangi bir soru", "external");
    expect(external.provenance).toBe("external");
  });
});

describe("processRecordedLesson pipeline", () => {
  it("moves a lesson through statuses to ready with a full study set (real transcript)", async () => {
    const s = withMockTranscription();
    const user = await s.auth.signIn("a@b.co");
    const course = await s.courses.create(user.id, "Biyoloji");
    const lesson = await s.lessons.create(course.id, user.id, "Fotosentez");

    const statuses: string[] = [];
    const { study, awaitingTranscription } = await processRecordedLesson(
      s,
      lesson.id,
      "mock://audio",
      120,
      { onStatus: (st) => statuses.push(st) }
    );

    expect(awaitingTranscription).toBe(false);
    expect(statuses).toEqual(["uploaded", "transcribing", "transcribed", "analyzing", "ready"]);
    expect(study!.summary.length).toBeGreaterThan(0);
    expect(study!.quiz.questions.length).toBe(10);
    expect(study!.flashcards.length).toBeGreaterThan(0);
    expect(study!.podcast).toBeDefined();

    const stored = await s.lessons.get(lesson.id);
    expect(stored?.status).toBe("ready");
    expect(stored?.study?.quiz.questions.length).toBe(10);
  });

  it("stops honestly at awaiting_transcription when transcription is pending (no fabrication)", async () => {
    // Default services => PendingTranscriptionService (what the app ships).
    const s = createMockServices();
    const user = await s.auth.signIn("a@b.co");
    const course = await s.courses.create(user.id, "Biyoloji");
    const lesson = await s.lessons.create(course.id, user.id, "Fotosentez");

    const statuses: string[] = [];
    const { study, awaitingTranscription } = await processRecordedLesson(
      s,
      lesson.id,
      "file:///rec.m4a",
      120,
      { onStatus: (st) => statuses.push(st) }
    );

    expect(awaitingTranscription).toBe(true);
    expect(study).toBeUndefined();
    expect(statuses).toEqual(["uploaded", "transcribing", "awaiting_transcription"]);

    const stored = await s.lessons.get(lesson.id);
    expect(stored?.status).toBe("awaiting_transcription");
    expect(stored?.study).toBeUndefined();
    expect(stored?.durationSec).toBe(120);

    // Audio preserved as the student's own recording; NO fabricated transcript.
    const sources = await s.sources.listByLesson(lesson.id);
    expect(sources.length).toBe(1);
    expect(sources[0].kind).toBe("recording");
    expect(sources[0].uri).toBe("file:///rec.m4a");
    expect(sources[0].extractedText).toBeUndefined();
    expect(sources[0].userId).toBe(user.id);
  });
});


describe("course management + clearAllLocalData", () => {
  it("renames and deletes a course; clearAllLocalData wipes courses/lessons/notes", async () => {
    const kv = new MemoryStore();
    const s = createMockServices(kv);
    const user = await s.auth.signIn("a@b.co");
    const course = await s.courses.create(user.id, "Fizik");

    const renamed = await s.courses.rename(course.id, "Fizik 101");
    expect(renamed.title).toBe("Fizik 101");

    await s.lessons.create(course.id, user.id, "Ders 1");
    await s.notes.create(user.id, "not", { courseId: course.id });

    await clearAllLocalData(kv);
    expect((await s.courses.list(user.id)).length).toBe(0);
    expect((await s.lessons.listByCourse(course.id)).length).toBe(0);
    expect((await s.notes.list(user.id)).length).toBe(0);
  });

  it("removes a single course", async () => {
    const s = createMockServices();
    const user = await s.auth.signIn("a@b.co");
    const c = await s.courses.create(user.id, "Kimya");
    await s.courses.remove(c.id);
    expect((await s.courses.list(user.id)).length).toBe(0);
  });
});


describe("user isolation", () => {
  it("never returns one user's courses/lessons/notes/progress to another user", async () => {
    const kv = new MemoryStore();
    const s = createMockServices(kv);

    // User A signs in, creates data.
    const a = await s.auth.signIn("a@x.co", "Ada");
    const aCourse = await s.courses.create(a.id, "A-Course");
    const aLesson = await s.lessons.create(aCourse.id, a.id, "A-Lesson");
    await s.notes.create(a.id, "A note", { courseId: aCourse.id, lessonId: aLesson.id });
    await s.quiz.grade(makeMockQuiz(), new Array(10).fill(0) as Array<0>, {
      userId: a.id,
      lessonId: aLesson.id,
      courseId: aCourse.id,
    });

    // User B signs in on the same device store.
    const b = await s.auth.signIn("b@x.co", "Berk");

    // B sees none of A's data.
    expect((await s.courses.list(b.id)).length).toBe(0);
    expect((await s.lessons.listRecent(b.id)).length).toBe(0);
    expect((await s.notes.list(b.id)).length).toBe(0);
    const bProg = await s.progress.summary(b.id);
    expect(bProg.coursesCount).toBe(0);
    expect(bProg.quizAttempts.length).toBe(0);

    // A still sees exactly A's own data.
    expect((await s.courses.list(a.id)).length).toBe(1);
    const aProg = await s.progress.summary(a.id);
    expect(aProg.quizAttempts.length).toBe(1);
    expect(aProg.quizAttempts[0].userId).toBe(a.id);
  });
});

describe("course/lesson ownership", () => {
  it("generated study content stays associated with its own course/lesson", async () => {
    const s = withMockTranscription();
    const user = await s.auth.signIn("a@x.co");
    const stat = await s.courses.create(user.id, "İstatistik");
    const bio = await s.courses.create(user.id, "Biyoloji");

    const statLesson = await s.lessons.create(stat.id, user.id, "Olasılık");
    await processRecordedLesson(s, statLesson.id, "mock://a", 60);

    // The study set (summary/quiz/flashcards) belongs to the İstatistik lesson.
    const stored = await s.lessons.get(statLesson.id);
    expect(stored?.courseId).toBe(stat.id);
    expect(stored?.study?.quiz.questions.length).toBe(10);

    // Biyoloji has no lessons / no leaked content.
    expect((await s.lessons.listByCourse(bio.id)).length).toBe(0);
    expect((await s.lessons.listByCourse(stat.id)).length).toBe(1);
  });

  it("notes are filterable by course and lesson", async () => {
    const s = createMockServices();
    const user = await s.auth.signIn("a@x.co");
    const c = await s.courses.create(user.id, "Ders");
    const l = await s.lessons.create(c.id, user.id, "Kayıt");
    await s.notes.create(user.id, "course note", { courseId: c.id });
    await s.notes.create(user.id, "lesson note", { courseId: c.id, lessonId: l.id });

    expect((await s.notes.list(user.id, { courseId: c.id })).length).toBe(2);
    expect((await s.notes.list(user.id, { lessonId: l.id })).length).toBe(1);
  });
});

describe("progress derivation", () => {
  it("derives counts, average, and difficult concepts from the user's own attempts", async () => {
    const s = withMockTranscription();
    const user = await s.auth.signIn("a@x.co");
    const c = await s.courses.create(user.id, "Ders");
    const l = await s.lessons.create(c.id, user.id, "Kayıt");
    await processRecordedLesson(s, l.id, "mock://a", 60);

    const quiz = makeMockQuiz();
    // All wrong -> weak topics recorded, 0%.
    const allWrong = quiz.questions.map((q) => ((q.correctIndex + 1) % 4) as 0 | 1 | 2 | 3);
    await s.quiz.grade(quiz, allWrong, { userId: user.id, lessonId: l.id, courseId: c.id });

    await s.flashcards.mark(l.id, "card1", "known", user.id);
    await s.flashcards.mark(l.id, "card2", "review", user.id);

    const p = await s.progress.summary(user.id);
    expect(p.coursesCount).toBe(1);
    expect(p.lessonsReady).toBe(1);
    expect(p.flashcardsStudied).toBe(2);
    expect(p.quizAttempts.length).toBe(1);
    expect(p.averageQuizPercentage).toBe(0);
    expect(p.difficultConcepts.length).toBeGreaterThan(0);
  });
});

describe("profile", () => {
  it("returns defaults then persists updates without losing preferences", async () => {
    const s = createMockServices();
    const user = await s.auth.signIn("a@x.co");
    const p0 = await s.profile.get(user.id);
    expect(p0.preferences.quizLength).toBe(10);

    await s.profile.update(user.id, { school: "Lise", preferences: { ...p0.preferences, quizLength: 20 } });
    const p1 = await s.profile.get(user.id);
    expect(p1.school).toBe("Lise");
    expect(p1.preferences.quizLength).toBe(20);
    // Untouched prefs preserved.
    expect(p1.preferences.podcastLength).toBe("short");
  });
});


describe("LocalAnalysisBackend — real grounded analysis", () => {
  const { LocalAnalysisBackend } = require("./localAnalysis");

  it("derives a summary grounded in the actual source text", async () => {
    const b = new LocalAnalysisBackend();
    const src =
      "Newton'ın birinci yasası eylemsizlik yasasıdır. İkinci yasa F eşittir m çarpı a. Üçüncü yasa etki tepki yasasıdır.";
    const study = await b.analyze(src, { language: "tr", quizLength: 10 });
    // Summary must be built from the source's own words (grounded).
    expect(study.summary).toContain("eylemsizlik");
    expect(study.concepts.length).toBeGreaterThan(0);
    expect(study.flashcards.length).toBeGreaterThan(0);
  });

  it("honors the requested quiz length (10 and 20)", async () => {
    const b = new LocalAnalysisBackend();
    const src = "Ortalama, medyan ve standart sapma temel istatistik kavramlarıdır. Varyans yayılımı ölçer.";
    const q10 = await b.analyze(src, { language: "tr", quizLength: 10 });
    const q20 = await b.analyze(src, { language: "tr", quizLength: 20 });
    expect(q10.quiz.questions.length).toBe(10);
    expect(q20.quiz.questions.length).toBe(20);
    // Every question is 4-option with a valid correct index.
    for (const question of q20.quiz.questions) {
      expect(question.options.length).toBe(4);
      expect(question.correctIndex).toBeGreaterThanOrEqual(0);
      expect(question.correctIndex).toBeLessThanOrEqual(3);
    }
  });

  it("returns a labeled placeholder for image/audio (no fabrication)", async () => {
    const b = new LocalAnalysisBackend();
    const img = await b.extract("image", { uri: "file://x.jpg" });
    expect(img.placeholder).toBe(true);
    expect(img.text).toContain("OCR");
    // Text input extracts for real.
    const txt = await b.extract("txt", { text: "gerçek metin" });
    expect(txt.placeholder).toBe(false);
    expect(txt.text).toBe("gerçek metin");
  });

  it("ask() is grounded: answers only from provided context", async () => {
    const b = new LocalAnalysisBackend();
    const ctx = { sources: ["Işık hızı saniyede yaklaşık 300 bin kilometredir."] };
    const hit = await b.ask(ctx, "Işık hızı nedir?", "sources");
    expect(hit.provenance).toBe("grounded");
    const miss = await b.ask(ctx, "Fransa'nın başkenti neresi?", "sources");
    expect(miss.provenance).toBe("not_found");
  });
});

describe("processSourceToLesson — source → grounded lesson", () => {
  const { LocalAnalysisBackend } = require("./localAnalysis");
  const { processSourceToLesson } = require("./sourcePipeline");

  it("creates a ready lesson, preserves the source, and grounds the study set in the source text (txt)", async () => {
    const s = createMockServices(new MemoryStore(), new LocalAnalysisBackend());
    const user = await s.auth.signIn("ogrenci@example.com");
    const course = await s.courses.create(user.id, "Fizik");

    const src =
      "Newton'ın birinci yasası eylemsizlik yasasıdır. İkinci yasa kuvvetin kütle çarpı ivmeye eşit olduğunu söyler. Üçüncü yasa her etkiye eşit ve zıt bir tepki olduğunu belirtir.";

    const { lesson, study, extractedPlaceholder } = await processSourceToLesson(
      s,
      new LocalAnalysisBackend(),
      { userId: user.id, courseId: course.id, title: "Newton Yasaları", kind: "txt", text: src }
    );

    // Real text → no placeholder.
    expect(extractedPlaceholder).toBe(false);
    expect(lesson.status).toBe("ready");
    expect(lesson.study).toBeTruthy();

    // Source preserved, associated with this user + lesson.
    const sources = await s.sources.listByLesson(lesson.id);
    expect(sources.length).toBe(1);
    expect(sources[0].userId).toBe(user.id);
    expect(sources[0].extractedText).toContain("Newton");

    // Grounded: a salient term from the source appears in the study output.
    const blob = JSON.stringify(study).toLowerCase();
    expect(blob).toContain("yasa");
  });

  it("flags a placeholder for an image source but still preserves it under the user's course", async () => {
    const s = createMockServices(new MemoryStore(), new LocalAnalysisBackend());
    const user = await s.auth.signIn("ogrenci@example.com");
    const course = await s.courses.create(user.id, "Tarih");

    const { lesson, extractedPlaceholder } = await processSourceToLesson(
      s,
      new LocalAnalysisBackend(),
      { userId: user.id, courseId: course.id, title: "Fotoğraf", kind: "photo", uri: "file://note.jpg", mime: "image/jpeg" }
    );

    expect(extractedPlaceholder).toBe(true);
    const sources = await s.sources.listByLesson(lesson.id);
    expect(sources.length).toBe(1);
    expect(sources[0].kind).toBe("photo");
    expect(sources[0].uri).toBe("file://note.jpg");
  });

  it("does not leak a lesson created for one user into another user's course list", async () => {
    const store = new MemoryStore();
    const s = createMockServices(store, new LocalAnalysisBackend());
    const a = await s.auth.signIn("a@example.com");
    const courseA = await s.courses.create(a.id, "A dersi");
    const { lesson } = await processSourceToLesson(s, new LocalAnalysisBackend(), {
      userId: a.id,
      courseId: courseA.id,
      title: "A materyali",
      kind: "txt",
      text: "Bu A kullanıcısına ait özel bir ders materyalidir.",
    });

    const b = await s.auth.signIn("b@example.com");
    expect((await s.lessons.listRecent(b.id)).find((l: any) => l.id === lesson.id)).toBeUndefined();
    expect((await s.courses.list(b.id)).length).toBe(0);
  });
});
