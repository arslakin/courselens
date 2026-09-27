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

---

## Phase 5 — Production-readiness & cost-protection pass (pre-deploy)

Goal: protect against accidental/abusive Bedrock usage while keeping the demo
easy to use and the infrastructure minimal. No Cognito, DynamoDB, WAF, or other
paid/persistent services added.

**A. Protection review — simplest appropriate approach.**
For a public hackathon demo, the simplest effective protection is
**API Gateway HTTP API stage-level throttling** (native, no extra
infrastructure, no cost) combined with **strict application-level input
limits**. This keeps the demo open (no login) while capping how fast and how
large requests can be — which is what bounds Bedrock spend.

**B. Application-level safeguards implemented.**
- **Strict request/file size caps:** decoded request body and uploaded file are
  each capped at 2 MB (`MAX_REQUEST_BYTES`, `MAX_FILE_BYTES`); oversized
  base64 is rejected *before* decoding. Returns HTTP 413.
- **Existing input/token truncation retained:** text truncated to
  `MAX_INPUT_CHARS` (20,000) before any model call; scanned-doc detection.
- **Early rejection of malformed requests:** method/route/body/JSON/field
  validation all happen before any Bedrock call; `overrideType` is validated
  against the allowed enum (invalid → 400).
- **Bounded retries:** the AWS SDK is configured with
  `max_attempts = BEDROCK_MAX_ATTEMPTS` (2), plus a single application-level
  JSON-parse retry — so the worst case is a small, predictable number of
  Converse calls per analysis.
- **No client model selection:** the model id is controlled entirely
  server-side (`config.BEDROCK_MODEL_ID`, env-overridable). The client cannot
  choose or influence the model; `overrideType` only affects document
  classification.
- **Safe error handling:** upstream/model/extraction/internal errors are logged
  server-side but return generic messages — no AWS or internal detail is
  exposed to clients. Only intentional, user-facing validation/input messages
  are returned.
- **Reasonable Lambda timeout:** 30 s (bounds worst-case billable duration).

**C. API Gateway throttling (SAM, no new infrastructure).**
`AWS::Serverless::HttpApi` supports stage `DefaultRouteSettings`. Configured
conservatively via parameters: `ThrottlingRateLimit = 5` req/s steady-state and
`ThrottlingBurstLimit = 10`. Exceeding these returns HTTP 429. This is a native
API Gateway setting — it adds no resources and no cost.

**D. AWS Budget / cost-alert recommendation (NOT created).**
Recommended before or right after deployment, as a safety net independent of
the app-level caps:

- Create a single **AWS Budgets** monthly cost budget (e.g. **$5 or $10**) with
  email alerts at 50% / 80% / 100% of the threshold. AWS Budgets allows a small
  number of budgets **at no charge** (the first two budgets are free), so this
  adds negligible/no cost.
- Optionally scope the budget with a cost-allocation tag (e.g. tag CourseLens
  resources `project=courselens`) so the alert reflects only this project.
- This can be created in the Billing console in a couple of minutes, or later
  via IaC. It is intentionally **left uncreated** here to avoid touching the
  account before deployment approval, and because it needs billing-scope
  permissions the deploy identity may not have.

> Suggested CLI (for reference only — not executed):
> `aws budgets create-budget ...` with a `COST` budget of $10/month and an
> `SNS`/email notification at 80%.

**E. Verified Amazon Nova Lite pricing (us-east-1, on-demand).**
Retrieved from the **AWS Price List API** (`aws pricing get-products
--service-code AmazonBedrock`), not estimated:

| Token type | Price |
|---|---|
| Input  | **$0.00006 per 1K tokens** ($0.06 / 1M) |
| Output | **$0.00024 per 1K tokens** ($0.24 / 1M) |

Cost model: one "analysis" = 2 Converse calls (classify + workflow); worst case
adds one JSON-retry call. Token estimate uses ~4 characters per token.

| Scenario | Per analysis | 100 analyses | 1,000 analyses |
|---|---|---|---|
| Normal (~4k-char input, ~740 output tokens) | ~**$0.0003** | ~**$0.03** | ~**$0.33** |
| Conservative worst case (20k-char input, 2,000 output tokens/call, classify + workflow + 1 retry) | ~**$0.0024** | ~**$0.24** | ~**$2.40** |

Even the worst case for 1,000 full analyses is a few dollars of Bedrock spend.
API Gateway and Lambda at this volume are within/near the free tier and
negligible by comparison.

**F. Tests.** Added safeguard tests (override-type enum validation, 413 size
caps, early base64 rejection, generic error messages that don't leak internals,
bounded-retry client config). Full suite: **59 passed.**

**Kiro's role.** Kiro reviewed the API, implemented the safeguards, added native
API Gateway throttling in SAM, verified live Nova Lite pricing via the AWS
Pricing API, computed the cost estimates, and updated the tests and docs — all
without creating any AWS resources.

**Milestone:** CourseLens is production-ready for a low-risk public demo,
pending deploy approval.

**Next step:** deploy with AWS SAM. **Paused pending explicit approval** — no
`sam deploy` run and no AWS resources created.

---

## Phase 6 — First backend deployment (AWS SAM)

Goal: deploy the CourseLens backend under its own isolated identity, with no
impact on RojAI/Dengbej. Frontend deployment intentionally deferred.

**Deployment identity & guardrails.**
- Deployed exclusively with the dedicated `--profile courselens`
  (`courselens-deployer`); the default profile / `rojai-deployer` was never used
  for application deployment.
- SAM artifacts use a dedicated private bucket `courselens-sam-artifacts-*`
  (Block Public Access on, SSE-S3, no public policy) — `--resolve-s3` avoided.
- Least-privilege deploy policy iterated additively as real deploys surfaced
  genuinely-required actions (each approved and applied out-of-band by an admin,
  then synced into `iam/courselens-deploy-policy.json`):
  - `cloudformation:CreateChangeSet` on the SAM transform
    (`aws:transform/Serverless-2016-10-31`).
  - `apigateway:TagResource` scoped to `/apis/*/stages` (SAM tags the stage).
- One template fix: the Lambda execution managed-policy `Description` used a
  folded scalar (`>`) whose trailing newline is rejected by IAM; changed to
  `>-`. (A formatting validation issue, not a permission problem.)

**Stack.** `courselens` — `CREATE_COMPLETE`. Seven resources, all CourseLens:
- `AWS::ApiGatewayV2::Api` (HTTP API) + `$default` `AWS::ApiGatewayV2::Stage`
- `AWS::IAM::ManagedPolicy` `courselens-api-execution-policy`
- `AWS::IAM::Role` `courselens-api-execution-role`
- `AWS::Lambda::Function` `courselens-api`
- two `AWS::Lambda::Permission` (analyze + explain routes)

The API base URL is a stack output (`ApiBaseUrl`); it is intentionally not
recorded here.

**Execution-role verification (post-deploy).**
- Permissions boundary attached: `courselens-execution-boundary`.
- Only the intended `courselens-api-execution-policy` attached; no inline
  policies; no `AdministratorAccess` or unrelated permissions.
- Nova invocation confirmed end-to-end via live API tests (below).
- Stage throttling live: rate 5 req/s, burst 10.
- Lambda: python3.12, arm64, 512 MB, 30 s timeout.

**Real end-to-end smoke tests (live API + Bedrock).**
Small synthetic inputs (no private student data); all returned HTTP 200 with
genuine Bedrock output and token usage:

| Test | Route | Result |
|---|---|---|
| Assignment | `/analyze` | classified `assignment`; full plan + concepts |
| Lecture notes | `/analyze` | summary + 5-question quiz |
| Reading | `/analyze` | summary + 5-question quiz |
| Explain further | `/explain` | plain-language explanation |

- Total token usage across tests: ~1,224 input + ~1,461 output ≈ **2,685 tokens**.
- Estimated Bedrock cost of the tests: **~$0.0004** (Nova Lite on-demand).
- Responses scanned: no AWS/internal detail or credentials leaked.

**Observation limitation.** CloudWatch `GetLogEvents` was not attempted because
reading log events is outside the deploy identity's permissions; log-group
creation is covered, but log inspection would need a separate read grant.

**Cost/resource check.** Only the expected resources exist (7 stack resources +
the private artifact bucket). No always-on/costly services; Lambda + HTTP API
are pay-per-use with no idle cost.

**Milestone:** CourseLens backend is live and serving genuine Bedrock responses
under an isolated, least-privilege identity.

**Next step:** frontend deployment (S3 + CloudFront) — **not started**; to be
reviewed separately. No frontend resources created yet.

---

## Phase 7 — Frontend deployment: CourseLens v1 is live

Goal: ship a public website a student can open and use. Static frontend on
S3 + CloudFront, wired to the live backend.

**Live URL:** https://d3o9p9y1e35hxv.cloudfront.net

**Frontend production wiring.**
- `config.js` points at the live API and sets `DEMO_MODE: false`.
- Demo mode is now **opt-in only** (`DEMO_MODE: true` or `?demo=1`); production
  can never silently fall back to mock data. If the API fails, the student sees
  a clear error.

**Frontend-hosting IAM (approved, minimal, additive).**
Deploying the site needed permissions the backend deploy policy lacked. The
exact denials were reported (`cloudfront:*`, `s3:CreateBucket` on a web bucket),
and only after approval were two statements added to `courselens-deploy-policy`
(now v4): S3 on `courselens-web-*` and CloudFront distribution/OAC management.
No `s3:*`, no `cloudfront:*`, no admin, boundary untouched. All application
deployment continued under `--profile courselens`.

**Resources created (frontend).**
- Private S3 bucket `courselens-web-<account>` — Block Public Access on, SSE-S3,
  reachable only via CloudFront (OAC + `AWS:SourceArn` bucket policy).
- CloudFront Origin Access Control (sigv4).
- One CloudFront distribution — HTTPS (`redirect-to-https`), `index.html` root,
  CachingOptimized, `PriceClass_100`.

**Public end-to-end test (live site + Bedrock).**
- Site loads over HTTPS; CSS/JS load; HTTP redirects to HTTPS.
- Served `config.js` confirms the real API and `DEMO_MODE: false`.
- Assignment sample ("3-page essay… Due Friday… 3 sources") → classified
  `assignment` with requirements, deliverables, deadline, 5-step action plan,
  and concepts (genuine Bedrock, ~1,140 tokens).
- Lecture sample → summary + key concepts + 5-question quiz.
- Explain Further → real plain-language explanation.
- PDF / DOCX / TXT uploads → correct auto-classification and genuine results.
- My Notes (add/edit/Copy All/Clear/.md/.txt/localStorage) verified against the
  deployed `app.js`.
- Layout is responsive (two columns → single column on mobile widths).

**Cost posture.** All pay-per-use, no always-on cost. Bedrock is the main
lever: ~$0.0003/analysis normal (~$0.30 per 1,000). CloudFront/S3/Lambda/API
Gateway are within or near free tier at demo volume. A $5–$10 AWS Budgets alert
is recommended.

**Privacy.** No credentials or secrets in the frontend; the browser calls only
the public CourseLens API; uploaded documents are read client-side and not
persisted by the frontend; notes stay in browser localStorage; no analytics or
third-party scripts.

**Milestone:** CourseLens v1 is complete and publicly usable.
