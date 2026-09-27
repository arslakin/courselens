# RojLearn Architecture

RojLearn turns course materials into actionable learning plans. This
document describes the minimal, serverless architecture chosen for the AWS
"Zero to Shipped" hackathon MVP and the reasoning behind each choice.

> **Naming note:** the product is **RojLearn**. All AWS resource identifiers,
> the Python package (`src/courselens/`), and `COURSELENS_*` environment
> variables retain the original `courselens-*` prefix. These are legacy
> internal infrastructure names, kept unchanged so working resources are not
> recreated; only user-facing branding is "RojLearn".

## Design principles

1. **Minimal and serverless.** As few moving parts as possible while remaining
   a real, publicly deployable AWS application. No servers to manage, pay-per-use.
2. **Cost-conscious.** No always-on or persistent-cost services. See the
   explicit "not used" list below.
3. **Guide, don't do the work.** The product helps students understand and plan
   their work; it never produces submittable answers. This is enforced in the
   prompt layer (`prompts.GUARDRAIL_SYSTEM`).
4. **Isolated.** RojLearn is fully separate from other projects. All AWS
   resources are/will be named with a `courselens` prefix, and no existing
   resources are modified.

## Target architecture (MVP)

```
Browser (static SPA)
   |  HTTPS (JSON)
   v
Amazon API Gateway (HTTP API)      -> courselens-*
   |
   v
AWS Lambda (single Python function) -> courselens-api
   |  1. extract text from input (PDF / DOCX / TXT / MD / pasted)
   |  2. classify document type (Bedrock)
   |  3. run workflow strategy    (Bedrock)
   |  4. explain-further on demand (Bedrock)
   v
Amazon Bedrock — Nova Lite via the Converse API (us-east-1)
```

- **Frontend:** static site on **S3 + CloudFront** for a public HTTPS URL.
  (Built in a later step; not part of steps 1–2.)
- **Backend:** one **AWS Lambda** (Python) behind an **API Gateway HTTP API**,
  with routes `/analyze` and `/explain`. A single function keeps IaC and
  deployment trivial.
- **AI:** **Amazon Bedrock**, model `amazon.nova-lite-v1:0`, via the
  **Converse** API in **us-east-1**. Model id is a single config constant so
  upgrading to Nova Pro is a one-line change.
- **File handling (MVP):** files are sent inline in the request and parsed
  in-Lambda. MVP documents are small, so this avoids needing an S3 upload
  bucket + presigned URLs on day one.
- **IaC / deploy:** **AWS SAM**.

## Why these services

| Choice | Why | Alternatives rejected (for now) |
|---|---|---|
| Lambda + API Gateway | Serverless, pay-per-request, zero idle cost, trivial to deploy for a single function | ECS/EC2 (always-on cost, ops overhead) |
| Bedrock Nova Lite (Converse) | Cheapest fast text model; Converse returns token usage; access already confirmed in us-east-1 | Self-hosted models, other providers |
| S3 + CloudFront (frontend) | Cheap static hosting with a public HTTPS URL | App servers |
| Inline file upload | Avoids an upload bucket for small MVP docs | S3 presigned upload (deferred) |
| SAM | Lightest IaC for one function + static site | CDK (fine, but heavier for this size) |

## Explicitly NOT used in the MVP

To stay minimal and cost-conscious, and per project rules, the MVP does **not**
use: DynamoDB, Cognito, Bedrock Agents, Step Functions, Textract, RDS, ECS,
EC2, or any other persistent/costly service. The MVP is **stateless** — there
is no database; each request is analyzed and returned without being stored.

## Backend module layout (`src/courselens/`)

| Module | Responsibility |
|---|---|
| `config.py` | Central config: region, model id, inference + safeguard limits (env-overridable) |
| `errors.py` | Domain exceptions for clean, user-facing error mapping |
| `bedrock_client.py` | Thin wrapper over the Bedrock Converse API; boto3 client is injectable for testing |
| `prompts.py` | All model-facing text, including the single `GUARDRAIL_SYSTEM` guardrail |
| `json_utils.py` | Robustly parse JSON out of model output (handles fences / stray prose) |
| `analyzer.py` | Core AI loop: classify, analyze (assignment vs lecture/reading), explain; retry + normalization |
| `extraction.py` | Text extraction for pasted text / TXT / MD / PDF / DOCX; size cap + scanned-doc detection |
| `pipeline.py` | High-level `analyze_text` / `analyze_file` / `explain_further` entry points |
| `api.py` | AWS Lambda handler: HTTP API adapter over the pipeline (validation, JSON errors, CORS) |

## API layer

The Lambda handler (`courselens.api.handler`) is a thin adapter over the
pipeline — no analysis logic is duplicated. It targets the API Gateway **HTTP
API v2** event/response format.

Routes:

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/analyze` | `{inputType:"text"\|"file", text?, fileName?, fileContentBase64?, overrideType?}` | assignment or lecture/reading result + `input` metadata |
| POST | `/explain` | `{context, target}` | `{explanation}` |
| OPTIONS | * | — | CORS preflight (204) |

Behavior:
- **Request validation** with clear 400s for missing/mistyped fields.
- **Consistent JSON error envelope:** `{"error": {"code": "...", "message": "..."}}`.
- **Status mapping:** input problems (empty, unsupported type, scanned doc) →
  422; upstream model/parse failures → 502; unknown route → 404; bad method →
  405; oversized body → 413; everything else → 500.
- **CORS:** permissive (`*`) during development so the static frontend can call
  the API; intended to be tightened to the CloudFront domain post-hackathon.
- **Base64 bodies** are supported (API Gateway may deliver binary/base64 bodies).

## SAM template (`template.yaml`)

- `AWS::Serverless::HttpApi` — `courselens-http-api`, with CORS config and
  **stage-level default throttling** (`DefaultRouteSettings`:
  `ThrottlingRateLimit`/`ThrottlingBurstLimit`, defaults 5 req/s, burst 10).
  This is a native API Gateway setting — no extra infrastructure, no cost — and
  is the primary guard against abusive/accidental Bedrock usage.
- `AWS::Serverless::Function` — `courselens-api`:
  - Runtime **python3.12**, **arm64** (Graviton — cheaper per-ms).
  - **512 MB** memory, **30 s** timeout (work is I/O-bound on Bedrock; small
    footprint keeps cost low while leaving margin for PDF/DOCX parsing).
  - Env vars `COURSELENS_MODEL_ID` and `COURSELENS_AWS_REGION`.
  - **Least-privilege IAM:** only `bedrock:InvokeModel`, scoped to
    `arn:aws:bedrock:<region>::foundation-model/amazon.nova-*`. No other
    permissions.
- `CodeUri: src/` with `src/requirements.txt` (pypdf, python-docx; boto3 is
  provided by the Lambda runtime).

## Frontend (`frontend/`)

Static site (plain HTML/CSS/JS, no build step), hosted on S3 + CloudFront.

- `index.html` — single-page layout following Upload → Understand → Explain →
  Plan → Study → Take Notes.
- `styles.css` — styling, responsive two-column layout (results + notes) that
  collapses to a single column on narrow/mobile widths.
- `config.js` — holds `API_BASE_URL` (the live API) and `DEMO_MODE`.
- `app.js` — input handling (paste / file drag-drop), the analyze + explain API
  client, result rendering for both workflows, classification display + user
  reclassification, and the My Notes notebook.

**No silent demo fallback.** Demo mode (canned local results) is **opt-in
only** — it requires `DEMO_MODE: true` in `config.js` or a `?demo=1` query
parameter. The deployed production build sets `DEMO_MODE: false`, so it never
serves mock data; if the live API fails, the student sees a clear error.

## Frontend hosting (S3 + CloudFront)

```
Browser ──HTTPS──> CloudFront distribution ──OAC(sigv4)──> private S3 bucket
                        │                                    (courselens-web-*)
                        └── redirect-to-https, index.html default root
```

- **S3 bucket** `courselens-web-<account>`: Block Public Access fully on,
  SSE-S3, **not** a public website bucket, no public ACLs. Its bucket policy
  grants `s3:GetObject` only to the CloudFront service principal, scoped by
  `AWS:SourceArn` to this one distribution — so the bucket is reachable only
  through CloudFront, never directly.
- **CloudFront** with an **Origin Access Control** (OAC, sigv4) as the only
  reader of the bucket; HTTPS enforced; `index.html` default root object;
  AWS-managed CachingOptimized policy; `PriceClass_100` (cheapest region set).
- Deployed with `--profile courselens` (least-privilege `courselens-deployer`).

### My Notes (client-only)

A lightweight student notebook that lives **entirely in the browser** via
`localStorage` (key `courselens.notes.v1`). Students can type/edit notes and
click "Add to Notes" beside any RojLearn result (summary, key concept,
explanation, requirement, action-plan step, quiz Q&A). Actions: Copy All,
Clear, Download `.md`, Download `.txt`.

**No AWS infrastructure** backs My Notes — no DynamoDB, no accounts, no cloud
sync, no backend storage. It adds zero infrastructure cost.

## Data model (stateless API contract)

The MVP has no persistence; the "data model" is the request/response JSON.

- **DocumentType:** `assignment | lecture_notes | reading | syllabus | rubric | dataset | other`
- **Assignment result:** `explanation`, `requirements[]`, `deliverables[]`,
  `deadlines[]`, `constraints[]`, `actionPlan[{step,title,detail}]`,
  `concepts[{name,whyItMatters}]`
- **Lecture/Reading result:** `summary`, `keyConcepts[{name,explanation}]`,
  `difficultConcepts[{name,explanation}]`, `quiz[{question,answer}]` (5 items)
- **Explain:** request `{context, target}` → response `{explanation}`

For the MVP, `syllabus`, `rubric`, `dataset`, and `other` are classified but
routed through the lecture/reading workflow until their dedicated strategies
are built.

## Safeguards

- **Input size cap** (`MAX_INPUT_CHARS`, default 20,000 chars): text is
  truncated before it reaches Bedrock, protecting context limits and cost.
- **Scanned-document detection** (`MIN_EXTRACTED_CHARS`): a PDF/DOCX that
  parses but yields almost no text is reported as scanned/image-only with a
  friendly "OCR not supported yet" message rather than failing silently.
- **JSON hardening:** model output is parsed defensively and retried once with
  a corrective nudge if it isn't valid JSON.

## Deferred until after the hackathon

PPTX, CSV/spreadsheets, images/OCR (Textract), dedicated syllabus/rubric/
dataset workflows, large-file S3 upload path, persistence + accounts
(DynamoDB/Cognito), multi-document "courses", and advanced orchestration
(Agents, Step Functions, RAG).
