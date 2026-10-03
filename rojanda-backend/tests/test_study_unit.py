"""Unit tests for the grounded study-material engine (Phase 2).

Covers chunking, grounding enforcement, malformed model output, provider
failure, the Bedrock safety gate, and the local grounded provider — all with
no network and no paid model calls.
"""
import json
import os
import sys
import unittest
from pathlib import Path

from botocore.exceptions import ClientError as BotoClientError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from rojanda_transcribe import study  # noqa: E402
from rojanda_transcribe.core import ClientError  # noqa: E402


TR_TEXT = (
    "Fotosentez bitkilerin ışığı kullanarak besin üretmesidir. "
    "Kloroplast fotosentezin gerçekleştiği organeldir. "
    "Klorofil ışığı emen yeşil pigmenttir. "
    "Fotosentez sonucunda oksijen açığa çıkar. "
    "Karbondioksit ve su fotosentezin girdileridir."
)


class ChunkingTests(unittest.TestCase):
    def test_short_transcript_single_chunk(self):
        chunks = study.chunk_transcript(TR_TEXT)
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].text.strip()[:10], TR_TEXT.strip()[:10])

    def test_long_transcript_splits_without_truncation(self):
        # Build a long transcript (many sentences) and verify no content is lost.
        sentence = "Bu cümle fotosentez hakkında önemli bir bilgi içerir. "
        long_text = sentence * 400  # ~21k chars
        chunks = study.chunk_transcript(long_text, target_chars=4000)
        self.assertGreater(len(chunks), 1)
        # Every chunk is within a reasonable bound of the target (allow one
        # trailing sentence overflow) and no chunk is empty.
        for c in chunks:
            self.assertTrue(c.text.strip())
            self.assertLessEqual(len(c.text), 4000 + len(sentence) + 1)
        # Concatenated chunk text preserves (almost) all sentences — nothing is
        # silently dropped by truncation.
        joined = " ".join(c.text for c in chunks)
        self.assertGreaterEqual(joined.count("fotosentez"), 390)

    def test_chunk_cap_enforced(self):
        huge = "Cümle. " * 100000
        chunks = study.chunk_transcript(huge, target_chars=100)
        self.assertLessEqual(len(chunks), study.MAX_CHUNKS)


class FingerprintTests(unittest.TestCase):
    def test_fingerprint_stable_and_sensitive(self):
        a = study.transcript_fingerprint("merhaba dünya")
        self.assertEqual(a, study.transcript_fingerprint("merhaba dünya"))
        self.assertNotEqual(a, study.transcript_fingerprint("merhaba dunya"))
        self.assertTrue(a.startswith("sha256:"))


class LocalProviderGroundingTests(unittest.TestCase):
    def test_local_provider_grounded_study(self):
        provider = study.LocalGroundedProvider()
        result = study.generate_study(TR_TEXT, "src_1", "tr", provider)
        self.assertTrue(result["summary"])
        self.assertTrue(result["concepts"])
        self.assertTrue(result["flashcards"])
        self.assertTrue(result["quiz"])
        norm = study._norm(TR_TEXT)
        for q in result["quiz"]:
            # Every quiz question's correct answer MUST be grounded in the text.
            self.assertTrue(study._grounded_in(q["options"][q["correctIndex"]], norm))
            self.assertEqual(len(q["options"]), 4)
            self.assertIn(q["correctIndex"], (0, 1, 2, 3))
        # Provenance chunkIndex present on artifacts.
        self.assertIn("chunkIndex", result["concepts"][0])

    def test_empty_transcript_rejected(self):
        with self.assertRaises(ClientError) as ctx:
            study.generate_study("   ", "src_1", "tr", study.LocalGroundedProvider())
        self.assertEqual(ctx.exception.status, 400)

    def test_oversized_transcript_rejected(self):
        big = "a" * (study.MAX_TRANSCRIPT_CHARS + 1)
        with self.assertRaises(ClientError) as ctx:
            study.generate_study(big, "src_1", "tr", study.LocalGroundedProvider())
        self.assertEqual(ctx.exception.status, 413)


class _FabricatingProvider:
    """A provider that invents an ungrounded quiz answer + a bad concept."""
    name = "fabricator"

    def generate_chunk(self, chunk_text, language):
        return {
            "summary": "Fotosentez bitkilerin ışığı kullanarak besin üretmesidir.",
            "concepts": [{"name": "fotosentez", "explanation": "Işıkla besin üretimi."}],
            "flashcards": [{"front": "Fotosentez nedir?", "back": "Işıkla besin üretimi."}],
            "quiz": [
                {  # correct answer NOT in transcript -> must be dropped
                    "prompt": "Uydurma soru?",
                    "options": ["Mars'ta yaşam var", "B", "C", "D"],
                    "correctIndex": 0,
                    "explanation": "uydurma",
                    "topic": "x",
                },
                {  # grounded correct answer AND grounded explanation -> kept
                    "prompt": "Kloroplast nedir?",
                    "options": [
                        "Kloroplast fotosentezin gerçekleştiği organeldir",
                        "yanlış1", "yanlış2", "yanlış3",
                    ],
                    "correctIndex": 0,
                    "explanation": "Kloroplast fotosentezin gerçekleştiği organeldir",
                    "topic": "kloroplast",
                },
            ],
        }


class GroundingEnforcementTests(unittest.TestCase):
    def test_ungrounded_quiz_answers_dropped_not_fabricated(self):
        result = study.generate_study(TR_TEXT, "src_1", "tr", _FabricatingProvider())
        prompts = [q["prompt"] for q in result["quiz"]]
        self.assertNotIn("Uydurma soru?", prompts)          # ungrounded dropped
        self.assertIn("Kloroplast nedir?", prompts)          # grounded kept
        for q in result["quiz"]:
            self.assertTrue(study._grounded_in(q["options"][q["correctIndex"]], study._norm(TR_TEXT)))


# The ACTUAL 101-character transcript from the first controlled Bedrock test.
# Low-information: it only says the user is testing whether "Randa" records and
# transcribes. Any definition of microphones/devices/people/automatic systems
# is OUTSIDE this source and must be rejected by the grounding layer.
SHORT_TR_SOURCE = (
    "dersi Randa yı denemek için kaydediyorum. E acaba? "
    "ses kaydı yapıyor mu ve transkripsiyon yapıyor mu?"
)


class _UnsupportedClaimsProvider:
    """Reproduces the real failure: grounded-looking artifacts whose
    explanations/answers inject outside knowledge not present in the source."""
    name = "unsupported"

    def generate_chunk(self, chunk_text, language):
        return {
            "summary": "Metin, Randa adlı bir sistemin ses kaydı ve transkripsiyon yapıp "
                       "yapmadığı hakkında bir soruyu içermektedir.",
            "concepts": [
                {
                    "name": "Ses Kaydı",
                    # FABRICATED: microphones/devices are not in the source.
                    "explanation": "Ses kaydı, çeşitli cihazlar kullanılarak yapılan bir işlemdir. "
                                   "Çevredeki sesler mikrofonlar tarafından yakalanıp kaydedilir.",
                },
                {
                    "name": "Transkripsiyon",
                    # FABRICATED: people/automatic systems are not in the source.
                    "explanation": "Transkripsiyon, sesli metinleri yazılı metinlere çevirme işlemidir. "
                                   "Bu işlem insanlar veya otomatik sistemler tarafından yapılır.",
                },
                {
                    # Concept name itself is not a source term -> omit entirely.
                    "name": "Yapay Zeka Mimarisi",
                    "explanation": "Derin öğrenme katmanları veriyi işler.",
                },
            ],
            "flashcards": [
                {
                    "front": "Ses kaydı nedir?",
                    # FABRICATED back.
                    "back": "Mikrofonlarla çevredeki seslerin cihazlar tarafından kaydedilmesidir.",
                },
            ],
            "quiz": [
                {
                    "prompt": "Transkripsiyon nasıl yapılır?",
                    "options": [
                        "İnsanlar veya otomatik sistemler tarafından",  # fabricated correct
                        "a", "b", "c",
                    ],
                    "correctIndex": 0,
                    "explanation": "Transkripsiyon otomatik sistemlerle yapılır.",  # fabricated
                    "topic": "transkripsiyon",
                },
            ],
        }


class GroundingPipelineTests(unittest.TestCase):
    """Adversarial grounding: the exact real-world fabrication must be rejected,
    valid paraphrases must survive, and nothing is ever invented to fill a gap."""

    def test_unsupported_claims_are_rejected_on_short_source(self):
        # The grounding layer must drop/omit the fabricated definitions rather
        # than persist outside knowledge. For such a short source, returning
        # little or nothing is the correct, honest outcome.
        provider = _UnsupportedClaimsProvider()
        try:
            result = study.generate_study(SHORT_TR_SOURCE, "src_1", "tr", provider)
        except ClientError as e:
            # Acceptable: insufficient grounded content -> 422, never fabricate.
            self.assertEqual(e.status, 422)
            return
        blob = json.dumps(result, ensure_ascii=False).lower()
        for fabricated in ("mikrofon", "cihaz", "otomatik sistem", "insanlar", "derin öğrenme", "yapay zeka"):
            self.assertNotIn(fabricated, blob, f"fabricated term leaked: {fabricated}")
        # The ungrounded concept name must be gone.
        self.assertNotIn("yapay zeka mimarisi", [study._norm(c["name"]) for c in result["concepts"]])

    def test_valid_paraphrase_is_accepted(self):
        # A faithful paraphrase reuses the source's content words -> grounded.
        src_tokens, src_prefixes = study._source_index(TR_TEXT)
        paraphrase = "Bitkiler ışığı kullanarak besin üretir."  # paraphrase of sentence 1
        self.assertTrue(study._is_grounded(paraphrase, src_tokens, src_prefixes))

    def test_fabricated_claim_is_detected(self):
        src_tokens, src_prefixes = study._source_index(TR_TEXT)
        fabricated = "Mikrofonlar ve cihazlar sesi otomatik sistemlerle kaydeder."
        self.assertFalse(study._is_grounded(fabricated, src_tokens, src_prefixes))

    def test_partially_supported_explanation_below_threshold_is_rejected(self):
        src_tokens, src_prefixes = study._source_index(TR_TEXT)
        # Half grounded ("fotosentez ... oksijen") + half invented ("mitokondri
        # hücrenin enerji santralidir") -> recall below threshold -> rejected.
        partial = "Fotosentez oksijen açığa çıkarır ve mitokondri hücrenin enerji santralidir."
        self.assertFalse(study._is_grounded(partial, src_tokens, src_prefixes))

    def test_concept_explanation_falls_back_to_extractive_when_drifted(self):
        # Grounded concept NAME, but a drifted explanation. The pipeline must
        # replace the explanation with a grounded extractive source sentence,
        # never keep the drift and never invent.
        class _DriftedExplProvider:
            name = "drift"

            def generate_chunk(self, chunk_text, language):
                return {
                    "summary": "Kloroplast fotosentezin gerçekleştiği organeldir.",
                    "concepts": [{
                        "name": "kloroplast",
                        "explanation": "Kloroplast bir tür güneş paneli gibi elektrik üretir.",  # drift
                    }],
                    "flashcards": [],
                    "quiz": [],
                }

        result = study.generate_study(TR_TEXT, "src_1", "tr", _DriftedExplProvider())
        kloroplast = [c for c in result["concepts"] if study._norm(c["name"]) == "kloroplast"]
        self.assertEqual(len(kloroplast), 1)
        expl = kloroplast[0]["explanation"].lower()
        self.assertNotIn("güneş paneli", expl)            # drift removed
        self.assertNotIn("elektrik", expl)
        self.assertIn("organel", expl)                     # grounded extractive replacement

    def test_unsupported_flashcard_back_is_replaced_or_omitted(self):
        class _BadBackProvider:
            name = "badback"

            def generate_chunk(self, chunk_text, language):
                return {
                    "summary": "Klorofil ışığı emen yeşil pigmenttir.",
                    "concepts": [],
                    "flashcards": [{
                        "front": "Klorofil nedir?",
                        "back": "Klorofil bir vitamin türüdür ve bağışıklığı güçlendirir.",  # fabricated
                    }],
                    "quiz": [],
                }

        try:
            result = study.generate_study(TR_TEXT, "src_1", "tr", _BadBackProvider())
        except ClientError as e:
            self.assertEqual(e.status, 422)
            return
        for f in result["flashcards"]:
            back = f["back"].lower()
            self.assertNotIn("vitamin", back)
            self.assertNotIn("bağışıklık", back)

    def test_unsupported_quiz_explanation_drops_question(self):
        class _BadQuizExplProvider:
            name = "badquizexpl"

            def generate_chunk(self, chunk_text, language):
                return {
                    "summary": "Fotosentez sonucunda oksijen açığa çıkar.",
                    "concepts": [],
                    "flashcards": [],
                    "quiz": [{
                        "prompt": "Fotosentez sonucunda ne açığa çıkar?",
                        "options": ["Fotosentez sonucunda oksijen açığa çıkar", "a", "b", "c"],
                        "correctIndex": 0,
                        # Explanation injects outside knowledge -> drop the question.
                        "explanation": "Oksijen solunumda kullanılır ve kana karışır.",
                        "topic": "oksijen",
                    }],
                }

        try:
            result = study.generate_study(TR_TEXT, "src_1", "tr", _BadQuizExplProvider())
        except ClientError as e:
            self.assertEqual(e.status, 422)
            return
        self.assertEqual(result["quiz"], [])  # ungrounded explanation -> dropped

    def test_completely_ungrounded_response_raises_insufficient_content(self):
        class _AllFabricatedProvider:
            name = "allfab"

            def generate_chunk(self, chunk_text, language):
                return {
                    "summary": "Roma İmparatorluğu MÖ 27'de kuruldu.",
                    "concepts": [{"name": "Roma", "explanation": "Antik bir imparatorluktu."}],
                    "flashcards": [{"front": "Roma neydi?", "back": "Bir imparatorluk."}],
                    "quiz": [{
                        "prompt": "Roma ne zaman kuruldu?",
                        "options": ["MÖ 27", "a", "b", "c"],
                        "correctIndex": 0,
                        "explanation": "MÖ 27'de kuruldu.",
                        "topic": "roma",
                    }],
                }

        with self.assertRaises(ClientError) as ctx:
            study.generate_study(TR_TEXT, "src_1", "tr", _AllFabricatedProvider())
        self.assertEqual(ctx.exception.status, 422)  # nothing grounded -> no fabrication

    def test_support_refs_validated_against_real_chunks(self):
        # In-range indices kept; out-of-range / garbage ignored; the artifact
        # text is still re-validated regardless of the citation.
        self.assertEqual(study._validate_support_refs([0, 2, 99, -1, "x", True], 3), [0, 2])
        self.assertEqual(study._validate_support_refs(1, 3), [1])
        self.assertEqual(study._validate_support_refs(None, 3), [])

    def test_deterministic_extractive_fallback_is_grounded(self):
        # The local provider's output is extractive by construction, so every
        # artifact is grounded in the source — a stable deterministic baseline.
        result = study.generate_study(TR_TEXT, "src_1", "tr", study.LocalGroundedProvider())
        src_tokens, src_prefixes = study._source_index(TR_TEXT)
        for c in result["concepts"]:
            self.assertTrue(study._is_grounded(c["explanation"], src_tokens, src_prefixes))
        for f in result["flashcards"]:
            self.assertTrue(study._is_grounded(f["back"], src_tokens, src_prefixes))

    def test_multichunk_grounding_rejects_cross_chunk_fabrication(self):
        # Two grounded chunks; a fabricated artifact must still be rejected even
        # though its words are absent from BOTH chunks.
        sentence = "Fotosentez bitkilerin ışığı kullanarak besin üretmesidir. "
        long_text = sentence * 200
        chunks = study.chunk_transcript(long_text, target_chars=4000)
        self.assertGreater(len(chunks), 1)

        class _MixedProvider:
            name = "mixed"

            def generate_chunk(self, chunk_text, language):
                return {
                    "summary": "Fotosentez bitkilerin ışığı kullanarak besin üretmesidir.",
                    "concepts": [
                        {"name": "fotosentez", "explanation": "Bitkiler ışıkla besin üretir."},
                        {"name": "fotosentez", "explanation": "Nükleer füzyon yıldızlarda gerçekleşir."},
                    ],
                    "flashcards": [],
                    "quiz": [],
                }

        result = study.generate_study(long_text, "src_1", "tr", _MixedProvider())
        blob = json.dumps(result, ensure_ascii=False).lower()
        self.assertNotIn("nükleer", blob)
        self.assertNotIn("füzyon", blob)


class SingleChunkSummaryGroundingTests(unittest.TestCase):
    """The summary must pass the SAME grounding contract whether the transcript
    is one chunk or many. A model summary is kept only if grounded; otherwise a
    deterministic extractive summary (authoritative source sentences only) is
    used. The ungrounded model summary is never persisted."""

    def _single_chunk_result(self, source, model_summary):
        class _P:
            name = "p"
            def generate_chunk(self, chunk_text, language):
                # Grounded concept/card so the set is not empty (-> 422).
                sents = study.sentences(chunk_text)
                term = study.salient_terms(chunk_text, 1)
                nm = term[0] if term else "x"
                return {
                    "summary": model_summary,
                    "concepts": [{"name": nm, "explanation": study.sentence_for(nm, sents)}],
                    "flashcards": [],
                    "quiz": [],
                }
        self.assertEqual(len(study.chunk_transcript(source)), 1)  # genuinely single-chunk
        return study.generate_study(source, "src_1", "tr", _P())["summary"]

    def test_grounded_single_chunk_paraphrase_accepted(self):
        # A faithful paraphrase reusing the source's content words is kept.
        paraphrase = "Bitkiler ışığı kullanarak besin üretir. Kloroplast fotosentezin organelidir."
        summary = self._single_chunk_result(TR_TEXT, paraphrase)
        toks, pfx = study._source_index(TR_TEXT)
        self.assertTrue(study._summary_is_grounded(summary, toks, pfx))
        self.assertEqual(summary, paraphrase)  # grounded model summary kept as-is

    def test_loosely_grounded_single_chunk_summary_rejected(self):
        # The EXACT 101-char bug case: faithful content but model framing words
        # push sentence recall below the threshold -> rejected -> extractive.
        loose = ("Metin, Randa adlı bir şeyin deneme kaydının olup olmadığını ve bu kaydın "
                 "ses kaydı yapıp yapmadığını ve transkripsiyon yapıp yapmadığını soruyor.")
        toks, pfx = study._source_index(SHORT_TR_SOURCE)
        self.assertFalse(study._summary_is_grounded(loose, toks, pfx))  # precondition
        summary = self._single_chunk_result(SHORT_TR_SOURCE, loose)
        self.assertNotEqual(summary, loose)                     # ungrounded model summary NOT persisted
        self.assertTrue(study._summary_is_grounded(summary, toks, pfx))  # fallback is grounded
        # Fallback is composed only of authoritative source sentences.
        src_sents = {study._norm(s) for s in study.sentences(SHORT_TR_SOURCE)}
        for s in study.sentences(summary):
            self.assertIn(study._norm(s), src_sents)

    def test_fabricated_single_chunk_summary_rejected(self):
        fabricated = "Fotosentez Mars'ta keşfedildi ve yapay zeka tarafından yönetilir."
        summary = self._single_chunk_result(TR_TEXT, fabricated)
        self.assertNotIn("Mars", summary)
        self.assertNotIn("yapay zeka", summary.lower())
        toks, pfx = study._source_index(TR_TEXT)
        self.assertTrue(study._summary_is_grounded(summary, toks, pfx))

    def test_rejected_summary_fallback_is_only_source_text(self):
        summary = self._single_chunk_result(TR_TEXT, "Tamamen alakasız uydurma bir cümle burada.")
        src_sents = {study._norm(s) for s in study.sentences(TR_TEXT)}
        for s in study.sentences(summary):
            self.assertIn(study._norm(s), src_sents)  # every summary sentence is a source sentence

    def test_deterministic_extractive_summary_skips_contentless_filler(self):
        # "E acaba?" has no content tokens; the extractive summary must not be
        # built from filler alone.
        out = study._deterministic_extractive_summary(SHORT_TR_SOURCE, *study._source_index(SHORT_TR_SOURCE))
        self.assertTrue(out.strip())
        self.assertNotEqual(study._norm(out), study._norm("E acaba?"))

    def test_multichunk_grounded_synthesis_still_accepted_unchanged(self):
        # Regression guard: the multi-chunk grounded-synthesis path is unchanged.
        sentence = "Fotosentez bitkilerin ışığı kullanarak besin üretmesidir. "
        long_text = sentence * 200
        chunks = study.chunk_transcript(long_text, target_chars=4000)
        self.assertGreater(len(chunks), 1)
        result = study.generate_study(long_text, "src_1", "tr", study.LocalGroundedProvider())
        toks, pfx = study._source_index(long_text)
        self.assertTrue(study._summary_is_grounded(result["summary"], toks, pfx))

    def test_multichunk_ungrounded_synthesis_still_falls_back(self):
        # Regression guard: multi-chunk fabricated synthesis still rejected.
        sentence = "Fotosentez bitkilerin ışığı kullanarak besin üretmesidir. "
        long_text = sentence * 200

        class _FabSynth(study.LocalGroundedProvider):
            name = "fabsynth"
            def synthesize_summary(self, chunk_summaries, language):
                return "Mars kolonisi 2050'de kurulacak."

        result = study.generate_study(long_text, "src_1", "tr", _FabSynth())
        self.assertNotIn("Mars", result["summary"])
        toks, pfx = study._source_index(long_text)
        self.assertTrue(study._summary_is_grounded(result["summary"], toks, pfx))


class _EmptyProvider:
    name = "empty"

    def generate_chunk(self, chunk_text, language):
        return {"summary": "", "concepts": [], "flashcards": [], "quiz": []}


class InsufficientContentTests(unittest.TestCase):
    def test_zero_artifacts_raises_rather_than_persist_empty(self):
        with self.assertRaises(ClientError) as ctx:
            study.generate_study(TR_TEXT, "src_1", "tr", _EmptyProvider())
        self.assertEqual(ctx.exception.status, 422)


class _MalformedProvider:
    name = "malformed"

    def generate_chunk(self, chunk_text, language):
        return "not a dict"  # type: ignore


class MalformedOutputTests(unittest.TestCase):
    def test_malformed_chunk_output_raises(self):
        with self.assertRaises(study.MalformedModelOutput):
            study.generate_study(TR_TEXT, "src_1", "tr", _MalformedProvider())

    def test_parse_model_json_variants(self):
        self.assertEqual(study.parse_model_json('{"a":1}'), {"a": 1})
        # tolerate code fences / leading prose
        self.assertEqual(study.parse_model_json('```json\n{"a":2}\n```'), {"a": 2})
        self.assertEqual(study.parse_model_json('Here you go: {"a":3} done'), {"a": 3})
        for bad in ["", "no json here", "[1,2,3]", "{not json}"]:
            with self.assertRaises(study.MalformedModelOutput):
                study.parse_model_json(bad)


class ProviderFactoryGateTests(unittest.TestCase):
    def setUp(self):
        self._saved = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._saved)

    def test_default_provider_is_local(self):
        os.environ.pop("ROJANDA_STUDY_PROVIDER", None)
        self.assertIsInstance(study.make_provider(), study.LocalGroundedProvider)

    def test_bedrock_requires_allow_gate(self):
        os.environ["ROJANDA_ALLOW_BEDROCK"] = "0"
        with self.assertRaises(study.ProviderError):
            study.make_provider("bedrock")

    def test_bedrock_gate_open_but_no_client_still_safe(self):
        os.environ["ROJANDA_ALLOW_BEDROCK"] = "1"
        prov = study.make_provider("bedrock")  # constructs, but no client
        self.assertEqual(prov.name, "bedrock")
        with self.assertRaises(study.ProviderError):
            prov.generate_chunk("metin", "tr")  # no client -> safe error, no network

    def test_bedrock_prompt_is_grounded_and_json_only(self):
        prompt = study.BedrockStudyProvider.build_prompt("DERS METNI", "tr")
        self.assertIn("SADECE", prompt["system"])          # only the given text
        self.assertIn("uydurma", prompt["system"])          # no fabrication
        self.assertIn("JSON", prompt["system"])
        self.assertIn("DERS METNI", prompt["user"])


class _FabricatingSynthProvider(study.LocalGroundedProvider):
    """Grounds the per-chunk MAP (via the real local provider) but returns an
    UNGROUNDED synthesized summary — the orchestrator must reject it and fall
    back to the grounded extractive join."""
    name = "fab-synth"

    def synthesize_summary(self, chunk_summaries, language):
        return "Mars kolonisi 2050'de kurulacak. Yapay zeka dünyayı ele geçirdi."


class _TrackingSynthProvider(study.LocalGroundedProvider):
    name = "tracking-synth"

    def __init__(self):
        self.reduce_input_count = 0

    def synthesize_summary(self, chunk_summaries, language):
        self.reduce_input_count = len(chunk_summaries)
        return super().synthesize_summary(chunk_summaries, language)


class FinalSynthesisTests(unittest.TestCase):
    def _long_grounded_transcript(self, minutes: int) -> str:
        # Build a realistic multi-sentence lecture of ~1,000 chars/min so the
        # chunker produces many chunks (every one must participate).
        base = (
            "Fotosentez bitkilerin ışığı kullanarak besin üretmesidir. "
            "Kloroplast fotosentezin gerçekleştiği organeldir. "
            "Klorofil ışığı emen yeşil pigmenttir. "
            "Fotosentez sonucunda oksijen açığa çıkar. "
            "Karbondioksit ve su fotosentezin temel girdileridir. "
            "Işık reaksiyonları tilakoid zarında gerçekleşir. "
        )  # ~330 chars
        reps = max(1, (minutes * 1000) // len(base))
        return (base * reps).strip()

    def test_multichunk_summary_is_grounded(self):
        text = self._long_grounded_transcript(10)
        chunks = study.chunk_transcript(text)
        self.assertGreater(len(chunks), 1)  # genuinely multi-chunk
        provider = _TrackingSynthProvider()
        result = study.generate_study(text, "src_1", "tr", provider)
        self.assertTrue(result["summary"])
        # Every MAP chunk's summary is passed into the final REDUCE — later
        # lecture sections cannot be silently omitted.
        self.assertEqual(provider.reduce_input_count, len(chunks))
        # The synthesized/joined summary must be grounded in the transcript.
        toks, prefixes = study._source_index(text)
        self.assertTrue(study._summary_is_grounded(result["summary"], toks, prefixes))
        self.assertEqual(result["chunkCount"], len(chunks))

    def test_ungrounded_synthesis_falls_back_to_extractive(self):
        text = self._long_grounded_transcript(10)
        result = study.generate_study(text, "src_1", "tr", _FabricatingSynthProvider())
        # The fabricated synthesis is rejected; the grounded extractive join is
        # used instead — nothing fabricated reaches the summary.
        self.assertNotIn("Mars", result["summary"])
        toks, prefixes = study._source_index(text)
        self.assertTrue(study._summary_is_grounded(result["summary"], toks, prefixes))


class MvpLengthBoundTests(unittest.TestCase):
    def _transcript(self, chars: int) -> str:
        base = "Fotosentez ışık ile besin üretimidir. "
        return (base * ((chars // len(base)) + 1))[:chars]

    def test_full_50_minute_transcript_processes_every_chunk(self):
        # ~50 min ≈ ~50k chars. Must process end-to-end, every chunk included,
        # with NO truncation.
        text = self._transcript(50_000)
        self.assertLessEqual(len(text), study.MVP_LESSON_MAX_CHARS)
        chunks = study.chunk_transcript(text)
        self.assertGreater(len(chunks), 1)
        result = study.generate_study(text, "src_1", "tr", study.LocalGroundedProvider())
        self.assertEqual(result["chunkCount"], len(chunks))  # all chunks counted
        self.assertTrue(result["summary"])
        self.assertTrue(result["concepts"])

    def test_transcript_beyond_mvp_is_rejected_not_truncated(self):
        text = self._transcript(study.MVP_LESSON_MAX_CHARS + 5_000)
        with self.assertRaises(ClientError) as ctx:
            study.generate_study(text, "src_1", "tr", study.LocalGroundedProvider())
        self.assertEqual(ctx.exception.status, 413)
        self.assertEqual(ctx.exception.code, "transcript_too_long_for_mvp")


class _FakeNovaBody:
    def __init__(self, payload):
        self.payload = payload

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class _RecordingNovaClient:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def invoke_model(self, **kwargs):
        self.calls.append(kwargs)
        return {"body": _FakeNovaBody(self.payload)}


class _FailingNovaClient:
    def __init__(self, error):
        self.error = error
        self.calls = []

    def invoke_model(self, **kwargs):
        self.calls.append(kwargs)
        raise self.error


class NovaInvokeModelContractTests(unittest.TestCase):
    """Native Nova Lite InvokeModel contract, fully mocked — never a paid call."""

    def setUp(self):
        self.saved_env = dict(os.environ)
        os.environ["ROJANDA_ALLOW_BEDROCK"] = "1"
        self.model_id = "eu.amazon.nova-lite-v1:0"
        self.study_json = {
            "summary": "Fotosentez bitkilerin ışığı kullanarak besin üretmesidir.",
            "concepts": [],
            "flashcards": [],
            "quiz": [],
        }

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self.saved_env)

    def _native_response(self, text):
        return {"output": {"message": {"content": [{"text": text}]}}}

    def test_chunk_uses_exact_nova_native_request_and_headers(self):
        client = _RecordingNovaClient(self._native_response(json.dumps(self.study_json)))
        provider = study.BedrockStudyProvider(model_id=self.model_id, client=client)
        self.assertEqual(provider.generate_chunk(TR_TEXT, "tr"), self.study_json)
        self.assertEqual(len(client.calls), 1)
        call = client.calls[0]
        self.assertEqual(call["modelId"], self.model_id)  # inference-profile ID, not a Claude ID
        self.assertEqual(call["contentType"], "application/json")
        self.assertEqual(call["accept"], "application/json")
        self.assertIsInstance(call["body"], bytes)
        body = json.loads(call["body"].decode("utf-8"))
        self.assertEqual(body["schemaVersion"], "messages-v1")
        self.assertEqual(body["system"], [{"text": provider.build_prompt(TR_TEXT, "tr")["system"]}])
        self.assertEqual(body["messages"][0]["role"], "user")
        self.assertEqual(body["messages"][0]["content"], [{"text": provider.build_prompt(TR_TEXT, "tr")["user"]}])
        self.assertEqual(body["inferenceConfig"], {"maxTokens": 2000, "temperature": 0.2, "topP": 0.9})

    def test_native_nova_response_text_is_extracted_then_json_parsed(self):
        client = _RecordingNovaClient(self._native_response(json.dumps(self.study_json)))
        provider = study.BedrockStudyProvider(model_id=self.model_id, client=client)
        self.assertEqual(provider.generate_chunk(TR_TEXT, "tr")["summary"], self.study_json["summary"])

    def test_synthesis_uses_native_schema_with_800_token_budget(self):
        client = _RecordingNovaClient(self._native_response("Birleştirilmiş kaynak özeti."))
        provider = study.BedrockStudyProvider(model_id=self.model_id, client=client)
        self.assertEqual(provider.synthesize_summary(["Birinci bölüm."], "tr"), "Birleştirilmiş kaynak özeti.")
        body = json.loads(client.calls[0]["body"].decode("utf-8"))
        self.assertEqual(body["schemaVersion"], "messages-v1")
        self.assertEqual(body["inferenceConfig"]["maxTokens"], 800)
        self.assertEqual(client.calls[0]["contentType"], "application/json")
        self.assertEqual(client.calls[0]["accept"], "application/json")

    def test_malformed_native_response_is_provider_error_with_safe_log(self):
        sensitive = "SENSITIVE_TRANSCRIPT_MUST_NOT_APPEAR"
        client = _RecordingNovaClient({"unexpected": sensitive})
        provider = study.BedrockStudyProvider(model_id=self.model_id, client=client)
        with self.assertLogs("rojanda.study", level="WARNING") as logs:
            with self.assertRaises(study.ProviderError) as ctx:
                provider.generate_chunk(sensitive, "tr")
        self.assertEqual(ctx.exception.code, "study_provider_error")
        joined = "\n".join(logs.output)
        self.assertIn("stage=chunk_response", joined)
        self.assertIn("error_class=KeyError", joined)
        self.assertIn(self.model_id, joined)
        self.assertNotIn(sensitive, joined)

    def test_boto_client_error_logs_only_safe_metadata(self):
        sensitive = "SENSITIVE_TRANSCRIPT_MUST_NOT_APPEAR"
        error = BotoClientError(
            {
                "Error": {"Code": "ValidationException", "Message": sensitive},
                "ResponseMetadata": {"HTTPStatusCode": 400, "RequestId": "request-123"},
            },
            "InvokeModel",
        )
        client = _FailingNovaClient(error)
        provider = study.BedrockStudyProvider(model_id=self.model_id, client=client)
        with self.assertLogs("rojanda.study", level="WARNING") as logs:
            with self.assertRaises(study.ProviderError) as ctx:
                provider.generate_chunk(sensitive, "tr")
        self.assertEqual(ctx.exception.code, "study_provider_error")
        joined = "\n".join(logs.output)
        self.assertIn("stage=chunk_invoke", joined)
        self.assertIn("error_class=ClientError", joined)
        self.assertIn("aws_error_code=ValidationException", joined)
        self.assertIn("http_status=400", joined)
        self.assertIn("request_id=request-123", joined)
        self.assertIn(self.model_id, joined)
        self.assertNotIn(sensitive, joined)

    def test_model_text_without_json_remains_malformed_model_output(self):
        client = _RecordingNovaClient(self._native_response("not JSON"))
        provider = study.BedrockStudyProvider(model_id=self.model_id, client=client)
        with self.assertRaises(study.MalformedModelOutput):
            provider.generate_chunk(TR_TEXT, "tr")


if __name__ == "__main__":
    unittest.main()
