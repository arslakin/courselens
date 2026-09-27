# CourseLens Build Log

A running log of the CourseLens hackathon build: major steps, decisions, tests,
Kiro's role, AWS integration, Bedrock tests, deployment, and milestones.

---

## Phase 0 — Environment & Bedrock verification

**AWS environment check (read-only).**
- AWS CLI available (`aws-cli/2.35.21`).
- Authenticated identity: IAM user `rojai-deployer`, account `387276719593`.
- Region configured: `us-east-1`.
- Confirmed the account can list and invoke Bedrock models in us-east-1.

**Bedrock invocation test (Amazon Nova Lite, Converse API, us-east-1).**
- Model: `amazon.nova-lite-v1:0`.
- Invocation succeeded; token usage returned. A "reply with exactly" prompt
  triggered a cautious refusal, but a reworded verbatim prompt returned exactly:
  `CourseLens Bedrock connection successful.`
- Combined test cost was negligible (~83 tokens total).
- No permission or configuration issues. No AWS resources created.

**Decision:** proceed with Python backend, AWS SAM for IaC, Nova Lite via
Converse, region us-east-1. Product refined from "lecture summarizer" to
"turn course materials into an actionable learning plan" (Upload → Understand →
Explain → Plan → Study).

---

## Phase 1 — Core AI loop + local file extraction (steps 1–2)

Goal: build and locally test the core backend with no AWS deployment.

**Project setup.**
- Initialized a clean Git repository; default branch renamed to `main`.
- Added `.gitignore` (ignores venvs, secrets/`.env`, `.aws-sam/`, caches).
- Added `requirements.txt` (boto3, pypdf, python-docx) and
  `requirements-dev.txt` (adds pytest).
- Adopted a `src/courselens/` package layout.

**Bedrock client wrapper (`bedrock_client.py`).**
- `BedrockRuntime.converse_text()` wraps the Converse API and normalizes the
  response (text + token usage).
- The boto3 client is injectable and created lazily, so unit tests never touch
  AWS or require credentials.

**Prompts + guardrails (`prompts.py`).**
- Single `GUARDRAIL_SYSTEM` message enforces the product rule: guide, don't
  complete graded work; JSON-only output.
- Prompts for classification, the assignment workflow, the lecture/reading
  workflow, and explain-further. All request strict JSON.

**Core AI loop (`analyzer.py`).**
- `classify`, `analyze`, and `explain`.
- Assignment inputs use the assignment workflow; all other types route through
  the lecture/reading workflow for the MVP (dedicated syllabus/rubric/dataset
  workflows deferred).
- Defensive JSON parsing (`json_utils.py`) with one corrective retry.
- Output normalization guarantees stable shapes for the future frontend even
  when the model returns malformed fields.

**File extraction (`extraction.py`).**
- Pasted text, TXT/Markdown, PDF (`pypdf`), DOCX (`python-docx`).
- Input-size safeguard: text truncated to `MAX_INPUT_CHARS` (20,000).
- Scanned-document detection: a PDF/DOCX that parses but yields almost no text
  raises a friendly "OCR not supported yet" error.
- UTF-8 (incl. BOM) and fallback decoding for text files.

**Pipeline (`pipeline.py`).**
- `analyze_text`, `analyze_file`, `explain_further` compose extraction +
  analysis and attach input metadata (source, truncated flag).

**Tests.**
- 33 automated tests using a fake Bedrock client (no network/AWS):
  extraction + safeguards, robust JSON parsing, the client wrapper, the full
  AI loop (both workflows, override, retry-on-bad-JSON, guardrail propagation),
  and the pipeline.
- A test caught a real UTF-8 BOM handling bug in the text extractor, which was
  fixed (decode with `utf-8-sig` first).
- Result: **33 passed.**

**Kiro's role.** Kiro (this AI dev environment) performed the environment and
Bedrock checks, designed the architecture with the developer, and implemented
the backend modules, tests, and docs, running the suite locally.

**AWS integration status.** Bedrock invocation verified in us-east-1. No AWS
resources have been created; the code runs and is tested entirely locally.

**Milestone:** core AI loop and file extraction complete and green locally.

**Next step:** wrap the pipeline in an AWS Lambda handler + API Gateway (routes
`/analyze`, `/explain`) with a SAM template, tested locally with `sam local`.
Per project rules, we STOP and report before the first AWS deployment.

---

## Phase 3 — API layer (AWS Lambda + API Gateway via SAM)

Goal: expose the pipeline over HTTP, defined in SAM, tested locally. No deploy.

**Lambda handler (`api.py`).**
- `courselens.api.handler` targets the API Gateway HTTP API v2 event format.
- Routes: `POST /analyze`, `POST /explain`, and `OPTIONS` preflight.
- Thin adapter over the pipeline — no analysis logic duplicated.
- Request validation with clear 400s; consistent error envelope
  `{"error": {"code","message"}}`.
- Status mapping: input problems → 422, model/parse failures → 502,
  unknown route → 404, bad method → 405, oversized body → 413, else 500.
- CORS enabled (permissive during development); base64 request bodies handled.

**SAM template (`template.yaml`).**
- `courselens-http-api` (HTTP API) + `courselens-api` Lambda.
- python3.12 on arm64 (Graviton), 512 MB, 30 s timeout — cost-conscious sizing
  for I/O-bound Bedrock calls.
- Env vars `COURSELENS_MODEL_ID`, `COURSELENS_AWS_REGION`.
- Least-privilege IAM: only `bedrock:InvokeModel`, scoped to
  `amazon.nova-*` in the configured region.
- `src/requirements.txt` for packaging (boto3 comes from the runtime).

**Tests.** Added 19 API tests (routing, validation, CORS, base64 body, and
error-to-status mapping) with the pipeline mocked. Total suite now green.

**Local verification.** The SAM CLI is not installed in this environment
(Docker is), so `sam local` / `sam validate` could not be run here. The
template was structurally validated by parsing it and asserting on its
resources, and the handler is fully covered by unit tests. Running `sam local`
is recommended on a machine with the SAM CLI before deployment.

---

## Phase 4 — Minimal frontend + My Notes

Goal: a clean, minimal static UI following Upload → Understand → Explain →
Plan → Study → Take Notes.

**Frontend (`frontend/`, no build step).**
- `index.html`, `styles.css`, `config.js`, `app.js`.
- Input: paste text or upload (PDF/DOCX/TXT/MD) with drag-and-drop.
- Analyze button; classification card shows the detected type with a
  reclassify + re-analyze control (user can correct the type).
- Assignment rendering: explanation, requirements, deliverables, deadlines,
  constraints, action plan, concepts.
- Lecture/reading rendering: summary, key concepts, difficult concepts, quiz.
- "Explain further" on steps and concepts, calling `/explain`.
- `config.js` `API_BASE_URL`: empty ⇒ demo mode (canned results) so the UI runs
  with no backend; set it to the deployed API to use Bedrock.

**My Notes (client-only, localStorage).**
- Editable notebook persisted to `localStorage` (`courselens.notes.v1`).
- "Add to Notes" beside every result piece (summary, key concepts,
  explanations, requirements, individual action-plan steps, quiz Q&A).
- Copy All, Clear (confirmed), Download `.md`, Download `.txt`.
- No DynamoDB, Cognito, accounts, cloud sync, or backend storage — zero added
  AWS cost.

**Local verification.** JS syntax-checked with `node --check`; the site was
served with `python3 -m http.server` and all assets returned HTTP 200; demo
classification routing verified.

**Cost control.** No DynamoDB, Cognito, Textract, Bedrock Agents, Step
Functions, RDS, EC2, ECS, OpenSearch, or SageMaker introduced. Architecture
remains serverless and minimal.

**Kiro's role.** Kiro implemented the API handler, SAM template, the full
static frontend and the My Notes notebook, wrote and ran the tests, and served
the app locally to verify it — all without creating any AWS resources.

**Milestone:** end-to-end local application (API layer + frontend + notes)
complete and tested locally.

**Next step:** deploy with AWS SAM (`sam build` / `sam deploy`) to create the
HTTP API + Lambda, then host the frontend on S3 + CloudFront. **Deployment is
paused pending explicit approval** — no `sam deploy` has been run and no AWS
resources have been created.
