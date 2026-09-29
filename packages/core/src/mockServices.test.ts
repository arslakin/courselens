import {
  MemoryStore,
  clearAllLocalData,
  createMockServices,
  makeMockQuiz,
  processRecordedLesson,
} from "./index";

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

describe("ChatService grounding", () => {
  it("answers from sources, returns not_found otherwise, and never mixes external", async () => {
    const s = createMockServices();
    const grounded = await s.chat.ask("lesson1", "Fotosentez nedir?", "sources");
    expect(grounded.provenance).toBe("grounded");

    const missing = await s.chat.ask("lesson1", "Osmanlı padişahları kimlerdir?", "sources");
    expect(missing.provenance).toBe("not_found");
    expect(missing.message.text).toContain("kaynaklarında yer almıyor");

    const external = await s.chat.ask("lesson1", "herhangi bir soru", "external");
    expect(external.provenance).toBe("external");
  });
});

describe("processRecordedLesson pipeline", () => {
  it("moves a lesson through statuses to ready with a full study set", async () => {
    const s = createMockServices();
    const user = await s.auth.signIn("a@b.co");
    const course = await s.courses.create(user.id, "Biyoloji");
    const lesson = await s.lessons.create(course.id, user.id, "Fotosentez");

    const statuses: string[] = [];
    const { study } = await processRecordedLesson(
      s,
      lesson.id,
      "mock://audio",
      120,
      { onStatus: (st) => statuses.push(st) }
    );

    expect(statuses).toEqual(["uploaded", "transcribing", "transcribed", "analyzing", "ready"]);
    expect(study.summary.length).toBeGreaterThan(0);
    expect(study.quiz.questions.length).toBe(10);
    expect(study.flashcards.length).toBeGreaterThan(0);
    expect(study.podcast).toBeDefined();

    const stored = await s.lessons.get(lesson.id);
    expect(stored?.status).toBe("ready");
    expect(stored?.study?.quiz.questions.length).toBe(10);
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
