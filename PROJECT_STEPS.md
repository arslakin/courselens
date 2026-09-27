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
