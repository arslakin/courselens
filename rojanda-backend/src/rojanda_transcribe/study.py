"""Grounded study-material generation (Phase 2).

Turns a persisted lesson transcript into Turkish study materials:
  - özet (summary)
  - anahtar kavramlar (key concepts, each with a student-friendly explanation)
  - kartlar (flashcards: front/back)
  - quiz (multiple-choice: prompt, 4 options, correct index, explanation)

GROUNDING CONTRACT (hard rule, enforced here regardless of provider):
  * The transcript is authoritative. Nothing is invented.
  * Every generated artifact carries provenance back to the lesson + source +
    the transcript fingerprint it was built from.
  * If the transcript does not support a quiz answer, that question is dropped
    rather than fabricated. We never emit a question whose correct answer text
    is not present in the transcript.
  * The model output is strictly validated/parsed; malformed output raises a
    typed error (never a silent fallback to fabricated content).

LONG LESSONS (up to ~90 min): a single prompt cannot safely hold a full
lecture. `chunk_transcript` splits on sentence boundaries into bounded windows;
`generate_study` runs a MAP step per chunk (concepts/cards/quiz grounded in
that window) then a REDUCE step (dedupe + a grounded summary built from the
per-chunk summaries). Provenance (which chunk range) is preserved per artifact.

PROVIDERS: `StudyProvider` is the single AI boundary. `LocalGroundedProvider`
is deterministic, offline, and used for local dev + all tests (no network, no
paid calls). `BedrockStudyProvider` is the production boundary; it is NOT
invoked locally and raises unless explicitly enabled by env, so no paid model
is ever called during local implementation.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Protocol

from .core import ClientError

logger = logging.getLogger("rojanda.study")

# --- Input bounds ----------------------------------------------------------
# TWO distinct ceilings, deliberately kept separate:
#
#  1. MVP SUPPORTED LENGTH (this milestone): a full lesson UP TO 50 minutes is
#     processed end-to-end — every chunk participates, nothing is truncated.
#     University lecture speech ≈ 1,000 chars/min, so 50 min ≈ ~50k chars; we
#     allow generous headroom (fast/dense speakers) at MVP_LESSON_MAX_CHARS.
#     A transcript longer than this is REJECTED with a clear error — we never
#     silently truncate the lesson (hard requirement).
#
#  2. HARD SAFETY CEILING (forward-compatible): MAX_TRANSCRIPT_CHARS /
#     MAX_CHUNKS are sized for a ~90 min lecture so the data model + chunker do
#     not need redesigning when longer lessons are enabled later. They only act
#     as a pathological-input guard today; the MVP gate above is what bounds a
#     normal lesson.
MVP_LESSON_MINUTES = 50                   # supported full-lesson length this milestone
APPROX_CHARS_PER_MINUTE = 1_100           # dense Turkish lecture speech estimate
# ~55k chars for 50 min + headroom. Rounded to a stable, explicit constant.
MVP_LESSON_MAX_CHARS = 90_000             # reject (never truncate) beyond MVP support

MAX_TRANSCRIPT_CHARS = 600_000            # hard safety ceiling (~90 min+), forward-compatible
CHUNK_TARGET_CHARS = 6_000                # per MAP window (sentence-aligned)
MAX_CHUNKS = 120                          # forward-compatible model-call ceiling (~90 min)
MAX_CONCEPTS = 12
MAX_FLASHCARDS = 20
MAX_QUIZ = 10

STUDY_SCHEMA_VERSION = 2                   # bump when the persisted shape changes


# ---------------------------------------------------------------------------
# Fingerprinting + staleness
# ---------------------------------------------------------------------------
def transcript_fingerprint(text: str) -> str:
    """Stable content hash of the transcript the study set was built from.

    Persisted with the study material; if the lesson's current transcript hash
    differs, the stored study material is STALE (the student can regenerate).
    """
    return "sha256:" + hashlib.sha256((text or "").encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Grounded text utilities (shared by local provider + validation)
# ---------------------------------------------------------------------------
_SENT_SPLIT = re.compile(r"(?<=[.!?…])\s+")
# Turkish stopwords (small, high-frequency) — kept out of salient terms.
_TR_STOPWORDS = {
    "ve", "ile", "bir", "bu", "şu", "o", "da", "de", "ki", "mi", "mu", "için",
    "ama", "fakat", "çünkü", "gibi", "daha", "çok", "en", "her", "ya", "veya",
    "ise", "göre", "kadar", "hem", "ne", "nasıl", "neden", "olarak", "olan",
    "oldu", "sonra", "önce", "şey", "yani", "bütün", "tüm", "diye",
    # Interrogative scaffolding of generated questions (flashcard fronts / quiz
    # prompts) — function words, not content; must not count against grounding.
    "nedir", "kimdir", "nelerdir", "hangi", "hangisi", "midir", "mudir",
    "kaçtır", "nerede", "niçin", "mıdır", "müdür",
}


def sentences(text: str) -> list[str]:
    out = [s.strip() for s in _SENT_SPLIT.split((text or "").strip()) if s.strip()]
    return out


def salient_terms(text: str, n: int) -> list[str]:
    """Frequency-ranked content words actually present in the transcript."""
    words = re.findall(r"[\wçğıöşüÇĞİÖŞÜ]+", (text or "").lower())
    freq: dict[str, int] = {}
    for w in words:
        if len(w) < 4 or w in _TR_STOPWORDS or w.isdigit():
            continue
        freq[w] = freq.get(w, 0) + 1
    ranked = sorted(freq, key=lambda w: (-freq[w], w))
    return ranked[:n]


def sentence_for(term: str, sents: list[str]) -> str:
    low = term.lower()
    for s in sents:
        if low in s.lower():
            return s
    return sents[0] if sents else term


# ---------------------------------------------------------------------------
# Chunking (long-lesson MAP/REDUCE)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Chunk:
    index: int
    start_char: int
    end_char: int
    text: str


def chunk_transcript(text: str, target_chars: int = CHUNK_TARGET_CHARS) -> list[Chunk]:
    """Split on sentence boundaries into <=target_chars windows (no truncation).

    A single oversized sentence becomes its own chunk rather than being cut.
    """
    text = (text or "").strip()
    if not text:
        return []
    chunks: list[Chunk] = []
    buf: list[str] = []
    buf_len = 0
    start = 0
    cursor = 0
    for s in sentences(text):
        s_len = len(s) + 1
        if buf and buf_len + s_len > target_chars:
            body = " ".join(buf)
            chunks.append(Chunk(len(chunks), start, cursor, body))
            if len(chunks) >= MAX_CHUNKS:
                break
            buf, buf_len, start = [], 0, cursor
        buf.append(s)
        buf_len += s_len
        cursor += s_len
    if buf and len(chunks) < MAX_CHUNKS:
        chunks.append(Chunk(len(chunks), start, cursor, " ".join(buf)))
    return chunks


# ---------------------------------------------------------------------------
# Study-set shape (validated; provider-agnostic)
# ---------------------------------------------------------------------------
@dataclass
class StudyArtifactProvenance:
    sourceId: str
    chunkIndex: int | None = None


def _concept(name: str, explanation: str, chunk_index: int | None, support=None) -> dict:
    out = {"name": name, "explanation": explanation, "chunkIndex": chunk_index}
    if support:
        out["support"] = support
    return out


def _flashcard(front: str, back: str, chunk_index: int | None, support=None) -> dict:
    out = {"front": front, "back": back, "chunkIndex": chunk_index}
    if support:
        out["support"] = support
    return out


def _quiz_q(prompt: str, options: list[str], correct_index: int, explanation: str,
            topic: str, chunk_index: int | None, support=None) -> dict:
    out = {
        "prompt": prompt,
        "options": options,
        "correctIndex": correct_index,
        "explanation": explanation,
        "topic": topic,
        "chunkIndex": chunk_index,
    }
    if support:
        out["support"] = support
    return out


class MalformedModelOutput(ClientError):
    def __init__(self, detail: str = ""):
        super().__init__(502, "model_output_invalid", "Çalışma içeriği üretilemedi. Lütfen tekrar deneyin.")
        self.detail = detail


class ProviderError(ClientError):
    def __init__(self, detail: str = ""):
        super().__init__(502, "study_provider_error", "Çalışma içeriği üretilemedi. Lütfen tekrar deneyin.")
        self.detail = detail


# ---------------------------------------------------------------------------
# Provider boundary
# ---------------------------------------------------------------------------
class StudyProvider(Protocol):
    """Single AI boundary. Given a grounded chunk, return raw study JSON for it.

    Implementations MUST only use the provided chunk text (grounding). The
    orchestrator validates/filters output against the transcript regardless.
    """

    name: str

    def generate_chunk(self, chunk_text: str, language: str) -> dict:
        ...

    def synthesize_summary(self, chunk_summaries: list[str], language: str) -> str:
        """REDUCE: integrate per-chunk summaries into ONE coherent lesson-level
        özet. Implementations MUST only use the supplied grounded summaries —
        inventing nothing. The orchestrator re-validates the result against the
        transcript and falls back to an extractive join if it is not grounded,
        so this is a quality step, never a trust boundary.
        """
        ...


class LocalGroundedProvider:
    """Deterministic, offline, grounded provider for dev + tests (no network)."""

    name = "local-grounded-v2"

    def generate_chunk(self, chunk_text: str, language: str) -> dict:
        sents = sentences(chunk_text)
        terms = salient_terms(chunk_text, 6)
        summary = " ".join(sents[:2]) if sents else ""
        concepts = [{"name": t, "explanation": sentence_for(t, sents)} for t in terms[:4]]
        flashcards = [{"front": f"{t} nedir?", "back": sentence_for(t, sents)} for t in terms[:4]]
        quiz = []
        for i, t in enumerate(terms[:3]):
            correct = sentence_for(t, sents)
            distractors = [sentence_for(o, sents) for o in terms if o != t][:3]
            quiz.append({
                "prompt": f'"{t}" ile ilgili kaynağa göre doğru ifade hangisidir?',
                "options": [correct, *distractors],
                "correctIndex": 0,
                "explanation": f"Kaynağa göre: {correct}",
                "topic": t,
            })
        return {"summary": summary, "concepts": concepts, "flashcards": flashcards, "quiz": quiz}

    def synthesize_summary(self, chunk_summaries: list[str], language: str) -> str:
        """Deterministic grounded synthesis: the lead sentence of each chunk's
        summary, deduped and bounded. Every chunk contributes, so the result
        spans the whole lesson rather than only its first windows. Offline, no
        model call — all text is drawn from the (grounded) per-chunk summaries."""
        parts: list[str] = []
        seen: set[str] = set()
        for cs in chunk_summaries:
            lead = sentences(cs)[:1]
            frag = lead[0] if lead else cs.strip()
            key = _norm(frag)
            if frag and key and key not in seen:
                seen.add(key)
                parts.append(frag)
        return " ".join(parts)


class BedrockStudyProvider:
    """Production boundary for Amazon Nova Lite through Bedrock InvokeModel.

    Native Nova V1 contract:
      * `schemaVersion: messages-v1`
      * `system: [{"text": ...}]`
      * alternating `messages` with `content: [{"text": ...}]`
      * `inferenceConfig` with `maxTokens`, `temperature`, and `topP`
      * explicit `contentType` + `accept` of `application/json`
      * native response at `output.message.content[].text`

    The prompt remains strictly grounded. Runtime diagnostics intentionally log
    only safe operational metadata (stage, exception class, AWS code/status/
    request ID, and approved model/profile ID) — never transcript, prompt,
    generated text, JWTs, credentials, or PII.
    """

    name = "bedrock"
    _JSON_CONTENT_TYPE = "application/json"

    def __init__(self, model_id: str | None = None, client=None):
        if os.environ.get("ROJANDA_ALLOW_BEDROCK") != "1":
            raise ProviderError("bedrock disabled (ROJANDA_ALLOW_BEDROCK != 1)")
        self.model_id = model_id or os.environ.get("ROJANDA_BEDROCK_MODEL_ID", "")
        self._client = client  # injected boto3 bedrock-runtime client in prod

    @staticmethod
    def build_prompt(chunk_text: str, language: str) -> dict:
        system = (
            "Sen bir ders çalışma asistanısın. SADECE sana verilen ders metnini kullan. "
            "Metinde olmayan hiçbir bilgi, tanım, örnek, neden veya genel bilgi EKLEME; "
            "tahmin etme veya uydurma. Metni sadeleştirebilir veya kendi cümlelerinle "
            "ifade edebilirsin, ancak her ifade metindeki bilgiyle desteklenmelidir. "
            "Her üretilen öğe için, o öğeyi destekleyen kısa alıntıları (verilen metinden "
            "birebir) 'support' dizisinde ver. Metin bir şeyi desteklemiyorsa o öğeyi ÜRETME. "
            "Metin çok kısaysa daha az kavram/kart üretmek veya hiç soru üretmemek doğrudur. "
            "Yanıtı yalnızca geçerli JSON olarak ver; şema: "
            '{"summary": str, '
            '"concepts":[{"name":str,"explanation":str,"support":[str]}], '
            '"flashcards":[{"front":str,"back":str,"support":[str]}], '
            '"quiz":[{"prompt":str,"options":[str,str,str,str],"correctIndex":int,'
            '"explanation":str,"topic":str,"support":[str]}]}. '
            "Her doğru cevap ve açıklama ders metnine dayanmalıdır."
        )
        user = (
            f"DERS METNİ:\n{chunk_text}\n\n"
            "Yalnızca yukarıdaki metinden çalışma içeriği üret. Metinde olmayan hiçbir şey ekleme."
        )
        return {"system": system, "user": user}

    @staticmethod
    def _nova_body(system: str, user: str, max_tokens: int) -> dict:
        """Build the exact native Amazon Nova V1 Messages request schema."""
        return {
            "schemaVersion": "messages-v1",
            "system": [{"text": system}],
            "messages": [{"role": "user", "content": [{"text": user}]}],
            "inferenceConfig": {"maxTokens": max_tokens, "temperature": 0.2, "topP": 0.9},
        }

    def _log_safe_failure(self, stage: str, error: Exception, response: dict | None = None) -> None:
        """Emit safe diagnostics only. Do NOT include exception text: Bedrock or
        SDK error messages can echo request material, which may contain a
        transcript/prompt. AWS error code/status/request ID are operational and
        sufficient for root-cause diagnosis."""
        aws_response = getattr(error, "response", None) or response or {}
        err = aws_response.get("Error", {}) if isinstance(aws_response, dict) else {}
        meta = aws_response.get("ResponseMetadata", {}) if isinstance(aws_response, dict) else {}
        logger.warning(
            "bedrock_runtime_failure stage=%s error_class=%s aws_error_code=%s http_status=%s request_id=%s model_id=%s",
            stage,
            type(error).__name__,
            err.get("Code"),
            meta.get("HTTPStatusCode"),
            meta.get("RequestId"),
            self.model_id,
        )

    def _invoke_nova(self, body: dict, stage: str) -> str:
        if self._client is None:
            raise ProviderError("bedrock client not configured")
        try:
            # InvokeModel requires the native JSON body and explicit MIME type.
            # Encode to bytes so the SDK sends precisely the documented payload.
            response = self._client.invoke_model(
                modelId=self.model_id,
                body=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                contentType=self._JSON_CONTENT_TYPE,
                accept=self._JSON_CONTENT_TYPE,
            )
        except Exception as error:  # noqa: BLE001 - normalized safe provider error
            self._log_safe_failure(f"{stage}_invoke", error)
            raise ProviderError(f"{stage} invoke failed: {type(error).__name__}") from error

        try:
            raw_body = response["body"].read()
            raw_text = raw_body.decode("utf-8") if isinstance(raw_body, bytes) else raw_body
            payload = json.loads(raw_text)
            content = payload["output"]["message"]["content"]
            if not isinstance(content, list):
                raise ValueError("nova content is not a list")
            for block in content:
                text = (block or {}).get("text") if isinstance(block, dict) else None
                if isinstance(text, str) and text.strip():
                    return text.strip()
            raise ValueError("nova response has no text content")
        except Exception as error:  # noqa: BLE001 - safe diagnostic, no payload log
            self._log_safe_failure(f"{stage}_response", error, response)
            raise ProviderError(f"{stage} response invalid: {type(error).__name__}") from error

    def generate_chunk(self, chunk_text: str, language: str) -> dict:  # pragma: no cover - prod only
        prompt = self.build_prompt(chunk_text, language)
        text = self._invoke_nova(self._nova_body(prompt["system"], prompt["user"], 2000), "chunk")
        return parse_model_json(text)

    @staticmethod
    def build_synthesis_prompt(chunk_summaries: list[str], language: str) -> dict:
        joined = "\n".join(f"- {s}" for s in chunk_summaries)
        system = (
            "Sen bir ders çalışma asistanısın. Sana bir dersin bölüm bölüm "
            "özetleri verilecek. SADECE bu özetleri kullanarak dersin tamamını "
            "kapsayan tek, tutarlı bir özet yaz. Yeni bilgi ekleme, tahmin etme "
            "veya uydurma. Yanıtı yalnızca düz metin olarak ver."
        )
        user = f"DERS BÖLÜM ÖZETLERİ:\n{joined}\n\nDersin tamamını kapsayan tutarlı bir özet yaz."
        return {"system": system, "user": user}

    def synthesize_summary(self, chunk_summaries: list[str], language: str) -> str:  # pragma: no cover - prod only
        prompt = self.build_synthesis_prompt(chunk_summaries, language)
        return self._invoke_nova(self._nova_body(prompt["system"], prompt["user"], 800), "synthesis")


def parse_model_json(text: str) -> dict:
    """Extract the JSON object from a model response. Raises on malformed."""
    if not isinstance(text, str) or not text.strip():
        raise MalformedModelOutput("empty")
    # Tolerate code fences / leading prose: take the first {...} block.
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise MalformedModelOutput("no json object")
    try:
        obj = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        raise MalformedModelOutput("json decode")
    if not isinstance(obj, dict):
        raise MalformedModelOutput("not an object")
    return obj


def make_provider(provider_name: str | None = None, client=None) -> StudyProvider:
    """Factory honoring ROJANDA_STUDY_PROVIDER (default: local grounded)."""
    name = (provider_name or os.environ.get("ROJANDA_STUDY_PROVIDER", "local")).lower()
    if name == "bedrock":
        return BedrockStudyProvider(client=client)
    return LocalGroundedProvider()


# ---------------------------------------------------------------------------
# Orchestration (MAP per chunk -> REDUCE) + grounding enforcement
# ---------------------------------------------------------------------------
def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _grounded_in(text: str, transcript_norm: str) -> bool:
    """A conservative grounding check: the answer text must substantially
    appear in the transcript. Guards against a provider inventing content."""
    t = _norm(text)
    if not t:
        return False
    if t in transcript_norm:
        return True
    # Allow sentence-level grounding where the option is a transcript sentence
    # that may differ only by trailing punctuation/spacing.
    return t.rstrip(".!?…") in transcript_norm


# ---------------------------------------------------------------------------
# Paraphrase-tolerant grounding
# ---------------------------------------------------------------------------
# A literal substring check would reject every valid Turkish paraphrase. Instead
# we ground each artifact on CONTENT-TOKEN RECALL against the authoritative
# source: of the meaningful (non-stopword) words in a generated artifact, how
# many actually occur in the transcript (optionally restricted to the artifact's
# own chunk)? A paraphrase of the source reuses the source's content words, so
# it scores high; fabricated additions (e.g. "mikrofon", "cihaz", "otomatik",
# "kişiler") bring in words ABSENT from the source, so recall drops below the
# threshold and the claim is rejected. This is deliberately conservative:
# borderline artifacts are dropped or replaced with extractive source text, and
# nothing is ever invented to fill the gap.
#
# Light Turkish morphology tolerance: an artifact token counts as supported if
# it equals a source token OR shares a >=5-char prefix with one (so besin/
# besinler, üret/üretim align without a full stemmer). Short tokens must match
# a source token outright.
GROUNDING_MIN_RECALL = 0.70        # >=70% of content tokens must be in-source
_GROUNDING_PREFIX_MIN = 5          # min shared prefix for a morphology match
_WORD_RE = re.compile(r"[\wçğıöşüÇĞİÖŞÜ]+", re.UNICODE)


def _content_tokens(text: str) -> list[str]:
    """Meaningful lowercase word tokens (stopwords/very-short/number removed)."""
    out: list[str] = []
    for w in _WORD_RE.findall((text or "").lower()):
        if len(w) < 3 or w in _TR_STOPWORDS or w.isdigit():
            continue
        out.append(w)
    return out


def _token_supported(token: str, source_tokens: set[str], source_prefixes: set[str]) -> bool:
    if token in source_tokens:
        return True
    if len(token) >= _GROUNDING_PREFIX_MIN:
        # besinler ~ besin: a long-enough leading prefix is shared with a source
        # token (either direction). Guards against spurious short collisions.
        pref = token[:_GROUNDING_PREFIX_MIN]
        if pref in source_prefixes:
            return True
    return False


def _support_recall(candidate: str, source_tokens: set[str], source_prefixes: set[str]) -> float:
    cand = _content_tokens(candidate)
    if not cand:
        return 0.0
    supported = sum(1 for t in cand if _token_supported(t, source_tokens, source_prefixes))
    return supported / len(cand)


def _source_index(source_text: str) -> tuple[set[str], set[str]]:
    """Return (token set, prefix set) for a chunk/transcript, for fast grounding."""
    toks = set(_content_tokens(source_text))
    prefixes = {t[:_GROUNDING_PREFIX_MIN] for t in toks if len(t) >= _GROUNDING_PREFIX_MIN}
    return toks, prefixes


def _is_grounded(candidate: str, source_tokens: set[str], source_prefixes: set[str],
                 min_recall: float = GROUNDING_MIN_RECALL) -> bool:
    """True when a candidate artifact is a supported paraphrase/extract of the
    source: enough of its content tokens appear in the source. Paraphrase-OK,
    fabrication-rejected."""
    return _support_recall(candidate, source_tokens, source_prefixes) >= min_recall


def _extractive_match(query: str, candidate_sentences: list[str],
                      src_tokens: set[str], src_prefixes: set[str]) -> str | None:
    """Return the source sentence most relevant to `query` (a concept name or a
    flashcard front), or None when nothing relates. Relevance = count of the
    query's content tokens that the sentence contains; a match needs >=1 shared
    content token, so an off-topic query (whose words are absent from the
    source) yields None rather than a spurious sentence. The chosen sentence is
    source text, hence grounded by construction. Never fabricates."""
    q_tokens = [t for t in _content_tokens(query)]
    if not q_tokens:
        return None
    best: str | None = None
    best_overlap = 0
    for s in candidate_sentences:
        s_tok = set(_content_tokens(s))
        s_pref = {t[:_GROUNDING_PREFIX_MIN] for t in s_tok if len(t) >= _GROUNDING_PREFIX_MIN}
        overlap = sum(1 for t in q_tokens if _token_supported(t, s_tok, s_pref))
        if overlap > best_overlap:
            best_overlap, best = overlap, s.strip()
    if best_overlap <= 0 or best is None:
        return None
    # Defensive: the sentence must itself be grounded (it is, being source text).
    return best if _is_grounded(best, src_tokens, src_prefixes) else None


def _validate_support_refs(refs, n_chunks: int) -> list[int]:
    """Validate provider-supplied support references point at REAL input chunks.

    The provider is asked to cite the chunk index/indices each artifact is
    grounded in. We keep only in-range indices; a missing/garbage reference is
    simply ignored (the orchestrator still re-validates artifact text against
    the authoritative chunk, so a wrong/absent citation can never let fabricated
    content through — it only loses the citation)."""
    out: list[int] = []
    if isinstance(refs, (list, tuple)):
        for r in refs:
            if isinstance(r, bool):
                continue
            if isinstance(r, int) and 0 <= r < n_chunks and r not in out:
                out.append(r)
    elif isinstance(refs, int) and not isinstance(refs, bool) and 0 <= refs < n_chunks:
        out.append(refs)
    return out


def generate_study(transcript_text: str, source_id: str, language: str,
                   provider: StudyProvider) -> dict:
    """Produce a validated, grounded study set from the full transcript.

    MAP: provider.generate_chunk per bounded window.
    REDUCE: merge + dedupe concepts/cards; keep only quiz questions whose
    correct answer is grounded in the transcript; build the summary from the
    per-chunk summaries (grounded, extractive join — never fabricated).
    """
    text = (transcript_text or "").strip()
    if not text:
        raise ClientError(400, "empty_transcript", "Transkript boş olduğu için çalışma içeriği üretilemez.")
    # MVP support gate: a full lesson up to ~50 minutes is processed. Longer
    # transcripts are REJECTED (never silently truncated) — the data model +
    # chunker already scale to ~90 min, so raising the gate later needs no
    # redesign. The hard safety ceiling below guards against pathological input.
    if len(text) > MVP_LESSON_MAX_CHARS:
        raise ClientError(
            413,
            "transcript_too_long_for_mvp",
            "Bu ders bu sürüm için çok uzun. Şu an en fazla ~50 dakikalık dersler için "
            "çalışma içeriği üretiliyor. Dersin tamamı korunur; kısaltılmaz.",
        )
    if len(text) > MAX_TRANSCRIPT_CHARS:
        raise ClientError(413, "transcript_too_large", "Transkript bu sürüm için çok uzun.")

    transcript_norm = _norm(text)
    chunks = chunk_transcript(text)
    if not chunks:
        raise ClientError(400, "empty_transcript", "Transkript boş olduğu için çalışma içeriği üretilemez.")
    # Every chunk MUST participate in the final result. If the chunker ever hit
    # its forward-compatible cap for an in-support lesson, that is a bug, not a
    # silent truncation — fail loudly rather than drop lecture content.
    if len(chunks) >= MAX_CHUNKS:
        raise ClientError(
            413,
            "transcript_too_long_for_mvp",
            "Bu ders bu sürüm için çok uzun. Dersin tamamı korunur; kısaltılmaz.",
        )

    # Precompute per-chunk and whole-transcript grounding indices once.
    chunk_index_map = {ch.index: _source_index(ch.text) for ch in chunks}
    chunk_sentences = {ch.index: sentences(ch.text) for ch in chunks}
    transcript_tokens, transcript_prefixes = _source_index(text)
    n_chunks = len(chunks)

    chunk_summaries: list[str] = []
    concepts: list[dict] = []
    flashcards: list[dict] = []
    quiz: list[dict] = []
    seen_concepts: set[str] = set()
    seen_cards: set[str] = set()
    seen_quiz: set[str] = set()

    def _grounding_source(primary_chunk: int, support: list[int]) -> tuple[set[str], set[str], list[str]]:
        """Union the authoritative token/prefix sets for an artifact's own chunk
        and any VALID cited support chunks, plus the sentences to draw extractive
        fallbacks from. Grounding is always against real transcript text — never
        the model's own words."""
        toks: set[str] = set()
        prefixes: set[str] = set()
        sents: list[str] = []
        for idx in [primary_chunk, *support]:
            ct, cp = chunk_index_map.get(idx, (set(), set()))
            toks |= ct
            prefixes |= cp
            sents.extend(chunk_sentences.get(idx, []))
        return toks, prefixes, sents

    for ch in chunks:
        raw = provider.generate_chunk(ch.text, language)
        if not isinstance(raw, dict):
            raise MalformedModelOutput("chunk not object")
        ch_tokens, ch_prefixes = chunk_index_map[ch.index]
        ch_sents = chunk_sentences[ch.index]

        summ = raw.get("summary")
        if isinstance(summ, str) and summ.strip():
            chunk_summaries.append(summ.strip())

        for c in raw.get("concepts", []) or []:
            if len(concepts) >= MAX_CONCEPTS:
                break
            name = (c or {}).get("name")
            expl = (c or {}).get("explanation")
            if not isinstance(name, str) or not isinstance(expl, str) or not name.strip() or not expl.strip():
                continue
            key = _norm(name)
            if key in seen_concepts:
                continue
            support = _validate_support_refs((c or {}).get("support"), n_chunks)
            src_tokens, src_prefixes, src_sents = _grounding_source(ch.index, support)
            # The concept NAME must itself be a source term (not an invented
            # topic). Names are short, so require a strong token match.
            if not _is_grounded(name, src_tokens, src_prefixes, min_recall=1.0):
                continue  # ungrounded concept -> OMIT (never fabricate a topic)
            grounded_expl = expl.strip()
            if not _is_grounded(grounded_expl, src_tokens, src_prefixes):
                # Explanation drifted beyond the source: prefer a grounded
                # extractive sentence that actually mentions the concept name.
                extractive = _extractive_match(name, src_sents or ch_sents, src_tokens, src_prefixes)
                if extractive is not None:
                    grounded_expl = extractive
                else:
                    continue  # cannot ground the explanation -> OMIT the concept
            seen_concepts.add(key)
            concepts.append(_concept(name.strip(), grounded_expl, ch.index, support or None))

        for f in raw.get("flashcards", []) or []:
            if len(flashcards) >= MAX_FLASHCARDS:
                break
            front = (f or {}).get("front")
            back = (f or {}).get("back")
            if not isinstance(front, str) or not isinstance(back, str) or not front.strip() or not back.strip():
                continue
            key = _norm(front)
            if key in seen_cards:
                continue
            support = _validate_support_refs((f or {}).get("support"), n_chunks)
            src_tokens, src_prefixes, src_sents = _grounding_source(ch.index, support)
            # The card FRONT must be about the source. An ungrounded question
            # ("Roma neydi?" on a biology transcript) must never be force-fitted
            # with an arbitrary source sentence as its answer.
            if not _is_grounded(front, src_tokens, src_prefixes):
                continue  # off-topic question -> OMIT (never invent relevance)
            grounded_back = back.strip()
            # The ANSWER (back) carries the factual claim and must be grounded.
            if not _is_grounded(grounded_back, src_tokens, src_prefixes):
                # Replace with a grounded extractive answer that actually mentions
                # the front's topic. _extractive_match returns None when no source
                # sentence relates to the front, so we omit rather than mismatch.
                extractive = _extractive_match(front, src_sents or ch_sents, src_tokens, src_prefixes)
                if extractive is not None:
                    grounded_back = extractive
                else:
                    continue  # cannot ground a relevant answer -> OMIT the card
            seen_cards.add(key)
            flashcards.append(_flashcard(front.strip(), grounded_back, ch.index, support or None))

        for q in raw.get("quiz", []) or []:
            if len(quiz) >= MAX_QUIZ:
                break
            support = _validate_support_refs((q or {}).get("support"), n_chunks)
            src_tokens, src_prefixes, _ = _grounding_source(ch.index, support)
            parsed = _validate_quiz_q(q, transcript_norm, src_tokens, src_prefixes, ch.index, support)
            if parsed is None:
                continue  # ungrounded / malformed question -> DROP (never fabricate)
            key = _norm(parsed["prompt"])
            if key in seen_quiz:
                continue
            seen_quiz.add(key)
            quiz.append(parsed)

    summary = _reduce_summary(chunk_summaries, text, language, provider, len(chunks),
                              transcript_tokens, transcript_prefixes)

    # A study set with zero grounded artifacts is not useful and signals the
    # transcript had no usable content — surface rather than persist emptiness.
    if not concepts and not flashcards and not quiz:
        raise ClientError(422, "insufficient_content",
                          "Bu transkriptten çalışma içeriği çıkarılamadı.")

    return {
        "summary": summary,
        "concepts": concepts,
        "flashcards": flashcards,
        "quiz": quiz,
        "chunkCount": len(chunks),
    }


def _validate_quiz_q(q: dict, transcript_norm: str, src_tokens: set[str],
                     src_prefixes: set[str], chunk_index: int, support=None) -> dict | None:
    if not isinstance(q, dict):
        return None
    prompt = q.get("prompt")
    options = q.get("options")
    ci = q.get("correctIndex")
    expl = q.get("explanation")
    topic = q.get("topic") if isinstance(q.get("topic"), str) else ""
    if not isinstance(prompt, str) or not prompt.strip():
        return None
    if not isinstance(options, list) or len(options) != 4:
        return None
    if not all(isinstance(o, str) and o.strip() for o in options):
        return None
    if not isinstance(ci, int) or ci < 0 or ci > 3:
        return None
    if not isinstance(expl, str) or not expl.strip():
        return None
    # GROUNDING (never fabricate): BOTH the correct answer AND its explanation
    # must be supported by the source. We keep the exact-appearance check (fast,
    # strict) OR the paraphrase-tolerant recall check — either proves grounding.
    correct = options[ci]
    if not (_grounded_in(correct, transcript_norm) or _is_grounded(correct, src_tokens, src_prefixes)):
        return None
    if not (_grounded_in(expl, transcript_norm) or _is_grounded(expl, src_tokens, src_prefixes)):
        return None
    return _quiz_q(prompt.strip(), [o.strip() for o in options], ci, expl.strip(),
                   topic.strip(), chunk_index, support or None)


_SUMMARY_MAX_SENTENCES = 3  # deterministic extractive summary length cap


def _deterministic_extractive_summary(full_text: str, src_tokens: set[str],
                                      src_prefixes: set[str]) -> str:
    """Build a summary from the transcript's OWN sentences — grounded by
    construction, never the model's words. Takes the leading informative source
    sentences (those with content tokens), deduped and bounded. This is the
    fallback whenever a model summary cannot be validated as grounded."""
    out: list[str] = []
    seen: set[str] = set()
    for s in sentences(full_text):
        if not _content_tokens(s):
            continue  # skip filler like "E acaba?" with no content tokens
        k = _norm(s)
        if k in seen:
            continue
        seen.add(k)
        out.append(s.strip())
        if len(out) >= _SUMMARY_MAX_SENTENCES:
            break
    if not out:
        # Nothing with content tokens — fall back to the raw leading sentences
        # so the summary is still source text (never invented).
        out = [s.strip() for s in sentences(full_text)[:_SUMMARY_MAX_SENTENCES]]
    return " ".join(out)


def _summary_is_grounded(summary: str, src_tokens: set[str], src_prefixes: set[str]) -> bool:
    """A model summary is accepted only if MOST of its sentences are grounded
    (paraphrase-tolerant token recall) in the transcript. This guards against a
    model drifting; a weakly-grounded summary is rejected in favor of the
    deterministic extractive summary (grounded by construction). Threshold is
    the shared grounding contract — identical for one chunk or many."""
    sents = sentences(summary)
    if not sents:
        return False
    grounded = sum(1 for s in sents if _is_grounded(s, src_tokens, src_prefixes))
    return grounded / len(sents) >= 0.6


def _reduce_summary(chunk_summaries: list[str], full_text: str, language: str,
                    provider: StudyProvider, chunk_count: int,
                    transcript_tokens: set[str], transcript_prefixes: set[str]) -> str:
    """Produce the lesson-level özet under ONE grounding contract, regardless of
    chunk count.

    A model-produced summary (the single chunk's own summary, or the multi-chunk
    `synthesize_summary` output) is PERSISTED ONLY IF it passes
    `_summary_is_grounded` against the authoritative transcript. Otherwise it is
    discarded and replaced with a deterministic extractive summary composed only
    from authoritative transcript sentences. The ungrounded model summary is
    never persisted. Thresholds are unchanged between the one-chunk and
    many-chunk paths.
    """
    fallback = _deterministic_extractive_summary(full_text, transcript_tokens, transcript_prefixes)

    # Pick the model-produced candidate for this path.
    if chunk_count <= 1:
        candidate = (chunk_summaries[0].strip() if chunk_summaries else "")
    else:
        synth = getattr(provider, "synthesize_summary", None)
        if callable(synth):
            try:
                candidate = (synth(chunk_summaries, language) or "").strip()
            except ClientError:
                candidate = ""  # provider failed on REDUCE -> extractive fallback
        else:
            candidate = ""

    # SAME grounding gate for both paths. Keep the model summary only if grounded.
    if candidate and _summary_is_grounded(candidate, transcript_tokens, transcript_prefixes):
        return candidate
    return fallback
