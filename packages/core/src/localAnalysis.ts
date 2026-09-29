/**
 * LocalAnalysisBackend — a real, offline, grounded analysis implementation.
 *
 * Unlike the earlier fixed mock content, this derives its output from the
 * ACTUAL source text the student provided, so the summary/concepts/quiz are
 * genuinely grounded in that material (output is a function of the input). It
 * runs with no AWS and lets the full vertical flow be tested end to end.
 *
 * The heavy AI steps (photo OCR, audio transcription, natural Turkish audio)
 * are backend-only; where on-device extraction isn't available this returns a
 * clearly-labeled placeholder (ExtractResult.placeholder = true) rather than
 * pretending. Screens depend only on the AnalysisBackend interface, so the
 * remote (RojAnda backend) implementation swaps in without UI changes.
 */
import type { StudySet, QuizQuestion } from "@rojanda/types";
import type {
  AnalysisBackend,
  AnalyzeOptions,
  AskContext,
  AskResult,
  ExtractResult,
  SourceInputKind,
} from "@rojanda/api";
import { mockId } from "./mockContent";

// --- small text utilities (deterministic, offline) -------------------------

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const TR_STOPWORDS = new Set(
  ("ve veya ile de da bir bu şu o çok daha en gibi için ise ama fakat ancak "
    + "the a an of to in is are and or for as by on at be that this it").split(" ")
);

/** Salient terms = most frequent, non-stopword, capitalized-or-long words. */
function salientTerms(text: string, n: number): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.split(/[^\p{L}\p{N}]+/u)) {
    const w = raw.trim();
    if (w.length < 4) continue;
    const key = w.toLocaleLowerCase("tr");
    if (TR_STOPWORDS.has(key)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, n)
    .map(([w]) => w);
}

/** The sentence that best explains a term = first sentence containing it. */
function sentenceFor(term: string, sents: string[]): string {
  const low = term.toLocaleLowerCase("tr");
  return sents.find((s) => s.toLocaleLowerCase("tr").includes(low)) ?? sents[0] ?? term;
}

// --- grounded study-set generation -----------------------------------------

function buildStudySet(text: string, opts: AnalyzeOptions): StudySet {
  const sents = sentences(text);
  const terms = salientTerms(text, 8);
  const tr = opts.language === "tr";

  // Summary: the first few source sentences (grounded, extractive).
  const summaryBody = sents.slice(0, 3).join(" ");
  const summary = tr
    ? `Bu materyalin özeti: ${summaryBody}`
    : `Summary of this material: ${summaryBody}`;

  const concepts = terms.slice(0, 5).map((term) => ({
    name: term,
    explanation: sentenceFor(term, sents),
    difficulty: "medium" as const,
  }));

  const explanations = terms.slice(0, 3).map((term) => ({
    concept: term,
    plain: tr
      ? `${term}: ${sentenceFor(term, sents)}`
      : `${term}: ${sentenceFor(term, sents)}`,
  }));

  const flashcards = terms.slice(0, 6).map((term) => ({
    id: mockId("fc"),
    front: tr ? `${term} nedir?` : `What is ${term}?`,
    back: sentenceFor(term, sents),
    state: "unseen" as const,
  }));

  // Quiz honoring requested length (10 or 20). Each question is grounded in the
  // source: the correct answer is the source sentence for a term; distractors
  // are other terms' sentences from the SAME material.
  const quiz = buildQuiz(terms, sents, tr, opts.quizLength);

  return { summary, concepts, explanations, flashcards, quiz };
}

function buildQuiz(
  terms: string[],
  sents: string[],
  tr: boolean,
  length: 10 | 20
): StudySet["quiz"] {
  const questions: QuizQuestion[] = [];
  // Cycle through available terms/sentences to reach the requested length.
  const pool = terms.length ? terms : ["konu"];
  for (let i = 0; i < length; i++) {
    const term = pool[i % pool.length];
    const correct = sentenceFor(term, sents);
    // Distractors: sentences for other terms (fallback to shuffled sentences).
    const others = pool.filter((tm) => tm !== term).map((tm) => sentenceFor(tm, sents));
    const distractors = dedupe([...others, ...sents])
      .filter((s) => s !== correct)
      .slice(0, 3);
    while (distractors.length < 3) distractors.push(tr ? "Bu materyalde yok" : "Not in this material");
    const options = shuffleWithAnswer(correct, distractors, i);
    questions.push({
      id: mockId("q"),
      prompt: tr ? `"${term}" ile ilgili doğru ifade hangisidir?` : `Which statement about "${term}" is correct?`,
      options: options.opts as [string, string, string, string],
      correctIndex: options.correctIndex,
      explanation: tr ? `Kaynağa göre: ${correct}` : `Per the source: ${correct}`,
      difficulty: i % 3 === 0 ? "easy" : i % 3 === 1 ? "medium" : "hard",
      topic: term,
    });
  }
  return { id: mockId("quiz"), questions };
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

function shuffleWithAnswer(
  correct: string,
  distractors: string[],
  seed: number
): { opts: string[]; correctIndex: 0 | 1 | 2 | 3 } {
  const all = [correct, ...distractors.slice(0, 3)];
  const correctIndex = (seed % 4) as 0 | 1 | 2 | 3;
  // Place correct at correctIndex, fill the rest with distractors in order.
  const opts: string[] = [];
  let d = 0;
  for (let i = 0; i < 4; i++) opts[i] = i === correctIndex ? all[0] : all[1 + d++];
  return { opts, correctIndex };
}

// --- backend implementation -------------------------------------------------

export class LocalAnalysisBackend implements AnalysisBackend {
  async extract(kind: SourceInputKind, input: { uri?: string; text?: string }): Promise<ExtractResult> {
    // Text-bearing inputs extract for real.
    if (input.text && input.text.trim()) {
      return { text: input.text, placeholder: false };
    }
    // Image OCR / audio transcription are backend-only; where the device can't
    // extract, return a clearly-labeled placeholder rather than fabricating.
    const label =
      kind === "image"
        ? "[Görsel içeriği: cihazda OCR yok — RojAnda arka ucu bağlandığında metne dönüştürülecek.]"
        : kind === "audio"
          ? "[Ses içeriği: cihazda konuşma tanıma yok — RojAnda arka ucu bağlandığında yazıya dökülecek.]"
          : "[İçerik çıkarılamadı.]";
    return { text: label, placeholder: true };
  }

  async analyze(text: string, opts: AnalyzeOptions): Promise<StudySet> {
    return buildStudySet(text, opts);
  }

  async ask(ctx: AskContext, question: string, mode: "sources" | "external"): Promise<AskResult> {
    if (mode === "external") {
      return {
        answer: "Dış kaynak araması bu sürümde henüz aktif değil.",
        provenance: "external",
      };
    }
    const corpus = [ctx.transcript ?? "", ...ctx.sources, ...(ctx.notes ?? [])]
      .filter(Boolean)
      .join(" ");
    const sents = sentences(corpus);
    // Grounded retrieval: find the source sentence overlapping the question.
    const qWords = new Set(
      question
        .toLocaleLowerCase("tr")
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 4 && !TR_STOPWORDS.has(w))
    );
    let best: { s: string; score: number } | null = null;
    for (const s of sents) {
      const sw = s.toLocaleLowerCase("tr").split(/[^\p{L}\p{N}]+/u);
      const score = sw.filter((w) => qWords.has(w)).length;
      if (score > 0 && (!best || score > best.score)) best = { s, score };
    }
    if (best) {
      return { answer: `Kaynaklarından: ${best.s}`, provenance: "grounded" };
    }
    return { answer: "Bu bilgi kaynaklarında yer almıyor.", provenance: "not_found" };
  }

  async podcastScript(study: StudySet, language: "tr" | "en"): Promise<string> {
    const tr = language === "tr";
    const concepts = study.concepts.map((c) => c.name).join(", ");
    return tr
      ? `Merhaba! Bu dersi birlikte kısaca tekrar edelim. ${study.summary} `
        + `Önemli kavramlar: ${concepts}. Başarılar!`
      : `Hi! Let's recap this lesson. ${study.summary} Key concepts: ${concepts}.`;
  }
}
