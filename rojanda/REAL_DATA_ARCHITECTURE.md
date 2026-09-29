# RojAnda — Real-Data Architecture (end-to-end MVP)

Planning + implementation notes for moving RojAnda from mock content to real
student input. No production AWS resources are created here; no deploy.

## Audit: what already exists and is reusable

| Component | Status | Reuse for RojAnda |
|---|---|---|
| RojLearn Python backend (`src/courselens/*`) | frozen v1, do not modify | **Logic reused as reference**: `bedrock_client`, `prompts`, `analyzer`, `extraction` (PDF/DOCX/TXT), `json_utils`. The RojAnda backend will be a sibling stack that borrows these patterns. |
| Deployed `courselens-api` (Lambda + HTTP API) | live | Proves the serverless-Bedrock path works. **Not reused verbatim** — its prompts return English + 5-question quizzes (RojLearn spec) and it is frozen. RojAnda needs Turkish + 10/20 quizzes, so it needs its own endpoint. |
| `courselens-deployer` IAM profile | exists | Can deploy a `rojanda-*` stack (scoped `courselens*`/`rojanda*` would need a policy addition). **Cannot call Bedrock/Transcribe/Polly directly** (deploy-only). |
| RojAnda mock services (`@rojanda/core`) | complete | The client already talks to clean service interfaces; the real backend swaps in behind the same interfaces. |

## Hard architectural constraint (and why)

The mobile client **must not** call AWS AI services (Bedrock/Transcribe/Polly)
directly, because that would require embedding AWS credentials in the app — a
security non-starter, and confirmed impossible anyway: the only RojAnda-scoped
identity (`courselens-deployer`) is denied Bedrock/Transcribe/Polly.

Therefore every AI step runs **server-side**, reached over HTTPS with a
per-user auth token. The client stays a thin, credential-free consumer of a
`AnalysisBackend` interface.

```
Mobile (Expo)                         RojAnda backend (future rojanda-* stack)
─────────────                         ─────────────────────────────────────────
Camera / File / Mic  ──capture──▶ local file (expo-file-system)
        │  presigned PUT (later)          S3  (private, per-user prefix)
        ▼
AnalysisBackend (interface)  ──HTTPS+JWT──▶  API Gateway ─▶ Lambda ─▶ {
   extractFromImage()                          Textract / Bedrock vision  (OCR)
   extractFromDocument()                       pypdf / python-docx        (text)
   analyze(text, {lang:'tr', quizLength})      Bedrock Nova (Turkish, grounded)
   transcribe(audio)                           Amazon Transcribe (tr-TR)
   ask(context, question, mode)                Bedrock Nova (grounded)
   synthesizePodcast(script)                   Amazon Polly (Turkish)
 }                                          }  Cognito identity → user isolation
```

## Client service boundary (implemented now)

New interface `AnalysisBackend` (in `@rojanda/api`) with the exact operations
the five priorities need. Two implementations, selected by config — screens
never change:

1. **`LocalAnalysisBackend`** (`@rojanda/core`) — runs now, offline, no AWS.
   - Real capture + real storage of the student's source (image/pdf/audio) on
     device, preserved so the student can return to it.
   - Real text extraction for **typed / pasted / .txt / .md** content.
   - For image OCR / audio transcription it uses a clearly-labeled local
     placeholder extractor (deterministic) **only** where on-device extraction
     isn't available in Expo Go, and analysis is genuinely grounded in whatever
     text was extracted. This lets the whole vertical flow run and be tested
     end-to-end today without inventing a backend.
   - `analyze()` produces Turkish, grounded output honoring `quizLength` (10/20).
2. **`RemoteAnalysisBackend`** (client) — calls the RojAnda backend endpoints
   below. Enabled by setting `ANALYSIS_BASE_URL` in config once the backend is
   deployed. No code change in screens.

### Endpoint contract (for the future backend; ready to wire)

All requests carry the Cognito JWT; the backend derives `userId` from the token
(never trusts a client-supplied userId) — **user isolation is enforced
server-side**. Request/response bodies:

```
POST /extract    { kind:"image"|"pdf"|"doc"|"txt", uploadRef|contentBase64 }
                 -> { text, meta }                # OCR / document text
POST /analyze    { text, language:"tr", quizLength:10|20, docType? }
                 -> { summary, concepts[], explanations[], flashcards[], quiz }
POST /transcribe { uploadRef, language:"tr-TR" }
                 -> { transcript, confidenceAvg } # async job in real impl
POST /ask        { context:{sources[],transcript?,notes[]}, question, mode }
                 -> { answer, provenance:"grounded"|"not_found"|"external",
                      citations[] }
POST /podcast    { script | { summary, concepts } , language:"tr" }
                 -> { audioRef, durationSec }      # Polly
```

## User isolation (hard requirement)

- Client: all reads/writes already scoped by `userId`; services never accept
  another user's id. Existing tests assert User B never sees User A's data.
- Backend (future): `userId` comes from the verified JWT, S3 keys are
  namespaced `<userId>/...`, DynamoDB partition key is `USER#<userId>`, and the
  Lambda role is least-privilege. No cross-user access path exists.

## Source preservation

Every captured item is stored as a `Source` (kind = photo/pdf/doc/recording/
voice_note) with its local `uri` and `extractedText`, associated with
`{userId, lessonId}`. The lesson workspace shows the original material; deleting
a lesson/course cascades its sources. Generated content references the source
it was grounded in.

## Grounding & labeling (RojAnda'ya Sor)

`ask()` returns a `provenance` tag rendered distinctly:
- **Kaynaklarından** — answer supported by the student's own material.
- **RojAnda açıklaması** — a generated plain-language explanation (clearly not a
  quote from the source).
- **Dış kaynak** — only when the student explicitly chooses "Dış Kaynaklarda
  Ara"; rendered in a separate, labeled block, never merged into grounded text.
The model is instructed to say "Bu bilgi kaynaklarında yer almıyor" rather than
imply unsupported content came from the source.

## What is real now vs. blocked on a backend deploy

**Real now (no AWS, works in Expo Go):**
- Real camera capture, document pick, audio recording, on-device file storage.
- Source preserved + associated with user/course/lesson.
- Real text extraction + grounded Turkish analysis for typed/pasted/txt content
  and any text the extractor produces, honoring 10/20 quiz length.
- Grounded Q&A over the lesson's stored text; source-vs-generated labeling.

**Blocked on a RojAnda backend deploy (needs approval + prod AWS):**
- OCR of arbitrary photos (Textract / Bedrock vision).
- Speech-to-text of real lecture audio (Amazon Transcribe tr-TR).
- Natural Turkish podcast **audio** (Amazon Polly).
- Server-side Bedrock for the heaviest analysis at scale.

For each blocked step the client already calls the `AnalysisBackend` interface,
so enabling it later is: deploy the `rojanda-*` stack, set `ANALYSIS_BASE_URL`,
switch the provider to `RemoteAnalysisBackend`. No screen changes.
