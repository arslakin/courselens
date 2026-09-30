# RojAnda — Proposed Architecture & Plan (Phase 1)

Planning only. No AWS resources created; the live RojLearn app is untouched.

> **SUPERSEDED WHERE IN CONFLICT (identity/backend):** production account,
> authentication, DynamoDB, S3-ownership, transcription-migration, and the AI
> study coach (now named **Rojber**) decisions are defined authoritatively in
> `rojanda/PRODUCTION_PHASE1_PLAN.md`. In particular: identity is the **Cognito
> User Pool `sub`** with a **JWT authorizer** (the Cognito **Identity Pool is
> removed** from the MVP), storage is a **single DynamoDB table `rojanda-app`**
> keyed by `OWNER#<sub>`, and S3 keys are prefixed `owners/<sub>/…`. Where this
> older document says otherwise, the Phase 1 plan wins.

## Confirmed product decisions (locked for implementation)

1. **Flashcards are in the first MVP** (generated alongside summary/concepts/
   explanations/quiz). SRS scheduling can come later; generation ships in MVP.
2. **Podcast / audio recap is the first feature after the MVP** — before
   grounded chat and before external search.
3. **AI is strictly grounded by default** in the student's own materials. If an
   answer isn't in those materials, RojAnda says so (e.g. "Bu bilgi
   kaynaklarında yok") rather than mixing in outside knowledge.
4. **"Dış Kaynaklarda Ara" is preserved as an explicit, opt-in mode** for later
   external research; its interface and separate-citation contract are designed
   now (see §10) even though it is implemented later.
5. **Turkish-first UI, localization-ready.** All user-facing strings go through
   a localization layer (i18n resource files keyed by locale, default `tr`), so
   additional languages can be added later without code changes. Model output
   is Turkish by default.
6. **All lecture recordings, transcripts, uploaded materials, and generated
   study content are private user data** — per-user isolation, encryption,
   least privilege, deletion controls (see §9).
7. **No RojAnda AWS resources are created or deployed** during planning.
Region assumption: **eu-central-1 (Frankfurt)** for lower latency to Turkey and
EU data residency (Bedrock model availability to be confirmed at build time; if
a needed model is missing there, split AI to us-east-1 and keep storage in EU).

---

## 1. Recommended architecture (serverless, pay-per-use)

```
React Native + Expo app (iOS/Android)
      | HTTPS (JWT from Cognito)
      v
Amazon API Gateway (HTTP API)
      |
      v
AWS Lambda (Python) — thin handlers per capability
      |            |               |            |            |
      v            v               v            v            v
  Amazon        Amazon          Amazon       Amazon        Amazon
  Bedrock      Transcribe        Polly          S3         DynamoDB
 (Nova: text) (tr-TR speech   (Turkish TTS  (audio/docs/  (metadata,
              → transcript)    → podcast)    photos)       history)
```

- **Upload path uses S3 presigned URLs** (client uploads audio/photos/PDFs
  directly to S3 — never through Lambda), which keeps Lambda payloads tiny and
  cost low and handles long recordings.
- **Long-running steps are asynchronous.** Transcription of a full lecture
  takes minutes, so it runs as an async job: Lambda starts a Transcribe batch
  job; completion is handled by an **S3 event → Lambda** (transcript landing)
  that then triggers the analysis + podcast steps. The app polls a
  `lesson.status` field or receives a push notification.
- **Orchestration:** start with **S3-event-driven Lambda chaining** (cheapest,
  simplest). If the pipeline grows, revisit **Step Functions** later — not for
  the MVP (keep infra minimal).

Why serverless: zero idle cost, scales to a beta's spiky usage, and matches the
cost principle. No RDS/ECS/EKS.

---

## 2. Mobile screen map

```
Onboarding / Auth (Cognito)
  └─ Sign in / Sign up (email or social)

Home  ── three big entry points:
  ├─ 📷 Fotoğraf Çek      → Camera → Source (photo) → (OCR design only in MVP)
  ├─ 📁 Kaynak Yükle       → File picker → Source (PDF/doc) → extract text
  └─ 🎙️ Dersi Kaydet       → Recorder → Recording → Transcript → Lesson study set

Courses (Derslerim)
  ├─ Course list
  └─ Course detail → Lessons list

Lesson detail (the study set) — tabs:
  ├─ Ders Özeti (summary)
  ├─ Ana Kavramlar (key concepts)
  ├─ Açıklamalar (explanations, expandable)
  ├─ Flashcards (flip/spaced)
  ├─ Quiz (answer + reveal)
  ├─ Podcast (audio player)
  └─ Sohbet (chat grounded in this lesson's sources)
       └─ toggle: "Dış Kaynaklarda Ara" (external, clearly labeled)

Recording screen
  ├─ record / pause / stop, elapsed time, level meter
  └─ upload progress → processing status (transcribing → analyzing → ready)

My Notes / Kaydedilenler (saved items, history)
Settings / Profile (account, language, data controls)
```

Home emphasizes the three capture actions; everything else is reachable from
Courses and Lesson detail.

---

## 3. Core user journey (Dersi Kaydet — the MVP spine)

1. Student taps 🎙️ **Dersi Kaydet**, records the lecture (audio saved locally,
   chunked).
2. App requests a presigned URL and uploads the audio to S3; creates a `Lesson`
   with `status = uploaded`.
3. S3 event → Lambda starts an **Amazon Transcribe** `tr-TR` batch job;
   `status = transcribing`.
4. Transcribe writes the transcript to S3 → event → Lambda stores the
   `Transcript`; `status = transcribed`.
5. Analysis Lambda calls **Bedrock (Nova)** with the transcript to produce, in
   Turkish, the summary, key concepts, explanations, flashcards, and quiz —
   each as structured JSON. Persists them; `status = analyzed`.
6. Podcast Lambda builds a short Turkish recap script (Bedrock) and synthesizes
   audio with **Amazon Polly** → S3; `status = ready`.
7. App shows the Lesson study set; student studies, and can **chat** with the
   lesson (answers grounded in its transcript/sources), optionally invoking
   external search.

---

## 4. Reusable RojLearn components

RojLearn's backend is already a clean, testable, serverless Python codebase.
Much of it transfers directly.

| RojLearn piece | Reuse for RojAnda | How |
|---|---|---|
| `bedrock_client.py` (Converse wrapper, injectable client, usage tracking) | **Direct** | Copy as-is; it's product-agnostic. |
| `json_utils.py` (robust JSON parsing + retry helper) | **Direct** | Copy as-is. |
| `errors.py` (domain exception hierarchy) | **Direct/extend** | Add speech/storage errors. |
| Analyzer pattern (prompt → Converse → parse → normalize, 1 retry) | **Adapt** | Same shape; new Turkish prompts + new output schemas (flashcards/quiz/podcast script). |
| `prompts.py` structure (centralized prompts + one system guardrail) | **Adapt** | Rewrite prompts in Turkish; replace the "don't do graded work" guardrail with a **"answer only from provided sources"** grounding guardrail. |
| `extraction.py` (PDF/DOCX/TXT, size caps, scanned detection) | **Adapt** | Reuse for 📁 Kaynak Yükle; move to async/S3 input; add image/OCR later. |
| `api.py` patterns (validation, consistent JSON errors, safe error messages, CORS) | **Adapt** | Same conventions; new routes + Cognito JWT authorizer; per-request user scoping. |
| Test approach (fake Bedrock client, 59 tests, no network) | **Direct pattern** | Same fixtures/fakes; add fakes for Transcribe/Polly/S3/DynamoDB. |
| SAM deployment patterns + least-privilege IAM + permissions boundary | **Adapt** | Same discipline; new `rojanda-*` stack, its own deploy identity + boundary. |
| Config-as-env-vars pattern | **Direct** | Reuse. |

**Stays only in RojLearn:** the assignment/anti-cheating workflow and its
"guide, don't do the work" guardrail; the current web frontend; the deployed
`courselens-*` infrastructure and public site (frozen as the hackathon v1).

---

## 5. New components required for RojAnda

- **Mobile app** (React Native + Expo): capture (camera/file/recorder), auth,
  course/lesson UI, flashcards/quiz/podcast players, chat, offline-friendly
  upload with progress.
- **Auth**: Cognito user pool + app integration; JWT authorizer on API Gateway.
- **Async transcription pipeline**: presigned upload, Transcribe job start,
  S3-event completion handler, status model.
- **Turkish prompt library + new output schemas**: summary, concepts,
  explanations, flashcards, quiz, podcast script — all grounded.
- **Podcast pipeline**: script generation (Bedrock) + Polly synthesis + S3.
- **Source-grounded chat**: retrieval over a lesson's own text + strict
  grounding guardrail; "Dış Kaynaklarda Ara" boundary (design only).
- **Persistence layer**: DynamoDB single-table design + access patterns.
- **Storage layout**: S3 buckets/prefixes for recordings, transcripts,
  documents, photos, podcast audio — all private, per-user scoped.
- **New serverless infra**: `rojanda-*` SAM stack, deploy identity, boundary.

---

## 6. AWS services recommended

| Need | Service | Notes |
|---|---|---|
| Mobile app | React Native + **Expo** | one iOS/Android codebase; fastest path |
| Auth | **Amazon Cognito** | user pool; JWT authorizer; free tier generous |
| API | **API Gateway HTTP API** | cheap, JWT authorizer built in |
| Logic | **AWS Lambda** (Python) | reuse RojLearn patterns |
| AI (text) | **Amazon Bedrock — Nova** | Turkish summaries/concepts/quiz/flashcards/chat |
| Speech-to-text | **Amazon Transcribe** | **`tr-TR` supported, batch + streaming**; use **batch** for long lectures |
| Text-to-speech | **Amazon Polly** | Turkish voice (**Filiz**, standard). Verify neural/long-form Turkish at build time; standard is fine for MVP recaps |
| Storage | **Amazon S3** | audio/docs/photos/podcasts; presigned uploads; private + SSE |
| Metadata/history | **Amazon DynamoDB** | serverless, pay-per-request; single-table |
| External research | *(deferred)* | interface only in MVP (see §10) |

Deliberately **not** used: RDS, ECS/EKS, EC2, OpenSearch, Kendra, Step
Functions (MVP), SageMaker.

---

## 7. Estimated MVP / small-beta cost

Assume a small beta: **50 students × 8 lessons/month = 400 lessons/month**, each
lecture ~45 min audio, transcript ~6k tokens, podcast script ~1.5k chars.

Verified/اpproximate unit prices (reconfirm at build time):
- **Transcribe** batch ~**$0.024/min** (first 250k min/mo; 60 min/mo free for 12
  months).
- **Bedrock Nova Lite**: input **$0.06/1M**, output **$0.24/1M** tokens
  (verified via AWS Price List API for the RojLearn work).
- **Polly**: Standard **$4/1M chars** (5M/mo free for 12 mo); Neural $16/1M
  (1M/mo free).
- **Lambda / API Gateway / Cognito / DynamoDB / S3**: within or near free tier
  at this volume.

Rough monthly estimate at 400 lessons:
| Item | Calc | Monthly |
|---|---|---|
| Transcribe | 400 × 45 min × $0.024 | ~**$432** |
| Bedrock (Nova) | 400 × ~5 calls × ~7k tok | ~**$1–3** |
| Polly (standard) | 400 × ~1.5k chars = 600k chars | ~**$0** (free tier) → ~$2.4 after |
| S3 + DynamoDB + API GW + Lambda + Cognito | low volume | ~**$1–5** |
| **Total** | | **~$440/month**, dominated by Transcribe |

**Cost takeaway:** transcription is ~98% of cost. Levers: cap recording length,
downsample audio, transcribe on demand (not automatically), and consider
streaming only for short clips. A **much smaller pilot** (e.g. 10 students, 40
lessons/mo) lands around **~$45/month**. Very low usage during development is
effectively free except a few dollars. Recommend an **AWS Budgets alert** and a
per-user monthly minutes cap from day one.

---

## 8. Main technical risks

1. **Transcription cost & accuracy** for long, noisy classroom Turkish audio —
   the dominant cost and a quality risk. Mitigate: batch mode, length caps,
   custom vocabulary for course terms, show confidence, let users edit.
2. **Turkish output quality** from the model (summaries/quiz correctness) —
   mitigate with strong Turkish prompts, JSON validation, and human-in-the-loop
   editing.
3. **Grounding integrity** — the product promise is "answer from my materials
   only." Prompt-only grounding can leak outside knowledge; needs strict
   prompting + retrieval + labeling, and evaluation. This is the core trust
   feature and the hardest to get right.
4. **Async pipeline complexity** — multi-step S3-event chaining and status
   tracking; partial failures must be recoverable and visible in the UI.
5. **Polly Turkish naturalness** — standard voice may sound robotic; verify
   neural/long-form Turkish availability; keep recaps short.
6. **Mobile audio capture** across iOS/Android (formats, background recording,
   long sessions, interruptions).
7. **Privacy/compliance** — recordings may capture teachers/classmates; Turkey
   (KVKK) and minors' data raise consent and residency obligations.

---

## 9. Privacy & security considerations

- **Sensitive data:** lecture recordings can capture third parties (teachers,
  classmates) and minors. Course materials may be copyrighted.
- **Consent:** require explicit in-app consent to record; surface guidance that
  the student is responsible for permission to record a class. Consider a
  visible "recording" indicator.
- **KVKK (Turkey) / GDPR:** prefer an **EU region** for storage; document data
  flows; provide account deletion and per-item delete ("verilerimi sil");
  minimize retention (auto-expire raw audio after processing if the user opts).
- **Isolation & least privilege:** per-user data partitioning in DynamoDB
  (partition key = userId); S3 keys namespaced by userId; Cognito-authenticated
  API with per-request user scoping; Lambda roles with least privilege +
  permissions boundary (same discipline as RojLearn).
- **Encryption:** S3 SSE (SSE-S3 or SSE-KMS), DynamoDB encryption at rest,
  HTTPS everywhere, presigned URLs short-lived.
- **No secrets in the app:** the mobile bundle ships no AWS keys; all access is
  via Cognito-issued tokens.
- **External-search labeling:** when "Dış Kaynaklarda Ara" is used, responses
  must visually and structurally separate external content and cite sources, so
  students never mistake outside info for their own material.
- **Minors:** flag age considerations; may need guardian consent and stricter
  data handling for under-18 users.

---

## 10. Source-grounded chat & external-source boundary (design only)

**Default (grounded) chat.** Each lesson has a corpus = its transcript +
uploaded sources. On a question:
1. Retrieve the most relevant chunks from *that lesson's* corpus (start simple:
   keep transcripts small enough to pass in-context; add embeddings/vector
   retrieval later if corpora grow).
2. Prompt Bedrock with a **grounding guardrail**: *answer only from the provided
   excerpts; if the answer isn't there, say "Bu bilgi kaynaklarında yok"* and
   offer the external-search option. Never invent citations.
3. Return the answer plus which source excerpts it used.

**External search boundary (interface, not built).** Define a single internal
capability:
```
research_external(query, lessonContext) -> {
  answer: str,
  sources: [ { title, url, snippet, publisher, retrievedAt } ]
}
```
- It is invoked **only** when the student taps "Dış Kaynaklarda Ara".
- Its output is rendered in a **separate, clearly labeled block** ("Dış
  kaynaklardan") with per-claim citations, never merged into the grounded
  answer.
- The response envelope always tags provenance:
  `{ "grounded": {...}, "external": {...|null} }` so the UI can render the two
  regions distinctly and the student always knows which is which.
- Implementation (web search / retrieval API) is chosen later; the interface
  and labeling contract are fixed now so the trust model is designed in.

---

## 11. Data model

Single **DynamoDB** table (single-table design), plus S3 for binary blobs.
Access is always scoped by `userId`.

**Entities & key attributes** (PK/SK sketch; GSIs as needed):

- **User** — `PK=USER#<userId>`, `SK=PROFILE` — email, displayName, locale,
  createdAt, consentFlags, plan.
- **Course** (Ders) — `PK=USER#<userId>`, `SK=COURSE#<courseId>` — title, term,
  color, createdAt.
- **Lesson** (Ders kaydı/oturum) — `PK=COURSE#<courseId>`,
  `SK=LESSON#<lessonId>` — title, date, `status`
  (`uploaded|transcribing|transcribed|analyzed|ready|failed`), durationSec,
  createdAt.
- **Source** (Kaynak) — `PK=LESSON#<lessonId>`, `SK=SOURCE#<sourceId>` —
  type (`photo|pdf|doc|txt|recording`), s3Key, mime, extractedTextS3Key,
  originLabel (`own`), createdAt.
- **Recording** — a Source of type `recording` — s3Key (audio),
  format, durationSec, language=`tr-TR`.
- **Transcript** — `PK=LESSON#<lessonId>`, `SK=TRANSCRIPT` — s3Key (full text),
  wordCount, confidenceAvg, editable, editedByUser (bool).
- **Summary** — `PK=LESSON#<lessonId>`, `SK=SUMMARY` — text (Turkish), model,
  usageTokens.
- **Concepts** — `SK=CONCEPTS` — [{ name, explanation, difficulty }].
- **Explanations** — `SK=EXPLANATIONS` — [{ concept, plainTurkish }].
- **Flashcards** — `SK=FLASHCARDS` — [{ front, back, ease/interval for SRS }].
- **Quiz** — `SK=QUIZ` — [{ question, options?, answer, rationale }].
- **Podcast** — `SK=PODCAST` — scriptS3Key, audioS3Key, durationSec, voiceId.
- **Chat** — `PK=LESSON#<lessonId>`, `SK=CHAT#<ts>#<msgId>` — role, text,
  grounded (bool), citedSourceIds[], external (bool).
- **History/events** — `PK=USER#<userId>`, `SK=EVENT#<ts>` — for activity feed.

S3 layout (all private, SSE): `s3://rojanda-media-<acct>/<userId>/<lessonId>/
{recording,transcript,podcast,sources}/...`.

---

## 12. Recording / transcription pipeline

```
Recorder → local chunks → presigned PUT to S3 (recording)
   → create Lesson(status=uploaded)
   → S3 ObjectCreated event → Lambda: StartTranscriptionJob (tr-TR, batch,
       output to S3 transcript prefix)   [status=transcribing]
   → Transcribe writes transcript.json to S3
   → S3 event → Lambda: store Transcript, kick off analysis [status=transcribed]
```
Notes: batch for long lectures; store both raw JSON and clean text; capture
average confidence; allow user edits before analysis; custom vocabulary for
course-specific terms; cap max minutes per recording (cost control).

## 13. Document / photo processing pipeline

```
📁 Kaynak Yükle: presigned PUT (pdf/docx/txt) → S3
   → S3 event → Lambda: extract text (reuse RojLearn extraction.py)
   → store extractedText → attach as Source(origin=own)

📷 Fotoğraf Çek (design only in MVP): presigned PUT (image) → S3
   → (later) Textract/Bedrock vision OCR → extractedText → Source
```
The PDF/DOCX/TXT path reuses RojLearn's `extraction.py` almost verbatim (moved
to read from S3). Photo/OCR is designed but deferred.

## 14. Podcast-generation pipeline

```
Lesson analyzed → Lambda: build short Turkish recap script (Bedrock, grounded
     in summary+concepts) → validate length
   → Amazon Polly SynthesizeSpeech (Turkish voice) → mp3 to S3
   → store Podcast(scriptS3Key, audioS3Key) [status=ready]
```
Keep recaps short (60–120s) to control Polly cost and keep them engaging. For
longer scripts, use Polly async synthesis to S3.

---

## Repository structure recommendation

Keep RojLearn frozen and add RojAnda as a **separate project**, ideally a
**new repository** (`rojanda`) so the hackathon submission repo stays clean and
RojAnda can evolve independently with its own IAM/deploy identity and CI.

Interim (during planning), RojAnda lives in this repo under `rojanda/` (docs
only) so nothing touches the live app. Proposed target layout for the new repo:
```
rojanda/
  mobile/            # React Native + Expo app
  backend/
    src/rojanda/     # Lambda handlers + shared libs (some copied from RojLearn)
    template.yaml    # rojanda-* SAM stack
    tests/
  iam/               # rojanda deploy identity + boundary (least privilege)
  docs/              # PRD, architecture, data model
```
Shared Python (bedrock client, json utils, errors) can be copied initially;
if duplication becomes painful later, extract a small shared package. Avoid a
monorepo coupling that risks the frozen RojLearn app.

---

## Proposed development phases

- **Phase 1 (this doc):** product + technical plan. ✅ No code/infra.
- **Phase 2 — Backend spine, local:** port reusable Python; write Turkish
  prompts + new schemas for **summary, concepts, explanations, flashcards,
  quiz**; analyzer + tests with fake clients. No AWS.
- **Phase 3 — Async transcription + storage:** S3 presigned uploads, Transcribe
  batch (tr-TR), S3-event handlers, DynamoDB single-table, status model; SAM
  `rojanda-*` stack + dedicated deploy identity/boundary. Deploy to a dev stack.
- **Phase 4 — Auth + API:** Cognito, JWT-authorized API Gateway routes,
  per-user scoping.
- **Phase 5 — Mobile app (MVP slice):** Expo app implementing sign in →
  create/select course → record → upload → view the full study set
  (Ders Özeti / Ana Kavramlar / Açıklamalar / **Flashcards** / 5-question Quiz)
  → save under lesson/course. TestFlight/APK beta. **This completes the MVP.**
- **Phase 6 — Podcast / audio recap (first post-MVP feature):** Bedrock recap
  script + Polly Turkish synthesis pipeline + player. Prioritized ahead of chat.
- **Phase 7 — Grounded chat:** retrieval + strict grounding guardrail +
  provenance UI (answers only from the student's own materials).
- **Phase 8 — External search ("Dış Kaynaklarda Ara"):** build behind the
  designed boundary with separate labeling/citations. (Interface preserved from
  the start; implementation here.)
- **Later — Photo/OCR** capture path, flashcard spaced-repetition scheduling,
  and additional UI languages via the localization layer.

---

## The smallest usable RojAnda MVP to build first

**"Record a Turkish lecture → get a full study set (with flashcards)."** One
vertical slice, end to end:

1. **Sign in** (Cognito).
2. **Create / select a Course** (Ders).
3. **Record** the Turkish lesson (🎙️ Dersi Kaydet).
4. **Upload** the recording (presigned S3 PUT).
5. **Turkish transcription** — Amazon Transcribe `tr-TR` (batch).
6. **AI analysis** — Bedrock (Nova), grounded strictly in the transcript,
   producing in Turkish:
   - **Ders Özeti** (summary)
   - **Ana Kavramlar** (key concepts)
   - **Açıklamalar** (plain-Turkish explanations)
   - **Flashcards**
   - **5-question Quiz**
7. **Save everything** under the Lesson → Course (transcript + all generated
   study content persisted as private user data).

**Flashcards are in this first MVP** (not deferred). Spaced-repetition
scheduling can stay minimal at first (simple flip cards; SRS intervals added
later), but flashcard generation ships in the MVP.

Deliberately deferred from this first slice: photo/OCR, grounded chat, external
search, and the podcast (which is the very next milestone — see below). This
slice proves the hardest, most valuable, most cost-sensitive path (Turkish
transcription + grounded Turkish analysis) end to end.

## Immediately after the MVP: Podcast / audio recap

The **first feature added right after** the core MVP is the **Podcast / audio
recap**: Bedrock builds a short Turkish recap script grounded in the lesson's
summary + concepts, Amazon Polly synthesizes Turkish audio to S3, and the app
plays it on the Lesson screen. This is prioritized ahead of grounded chat and
external search.
