# RojLearn

**RojLearn turns course materials into actionable learning plans.**

**Live demo:** https://d3o9p9y1e35hxv.cloudfront.net

> **Naming note:** the product is **RojLearn**. The underlying AWS
> infrastructure and code retain the original internal prefix `courselens-*`
> (Lambda, S3 buckets, IAM roles/policies, CloudFormation stack, the Python
> package, and `COURSELENS_*` env vars). These are legacy internal identifiers,
> intentionally left unchanged to avoid recreating working infrastructure.

RojLearn is an AI study assistant built for the AWS "Zero to Shipped"
hackathon. A student uploads or pastes a course document; RojLearn identifies
what kind of material it is and then applies the right strategy — explaining an
assignment and building a step-by-step action plan, or summarizing lecture
notes/readings and generating a study quiz.

Its guiding principle: **guide students through their work, never do it for
them.**

## Problem

Students are handed dense assignments, lecture notes, and readings with little
guidance on *how* to approach them. Assignments in particular bury requirements,
deliverables, deadlines, and constraints in prose. RojLearn reads the material
and turns it into something actionable — an explanation, a plan, and the
concepts to learn — without producing submittable answers.

## Features

- **Automatic document-type classification:** assignment, lecture notes,
  reading, syllabus, rubric, dataset, or other.
- **Assignment workflow:** plain-language explanation, requirements,
  deliverables, deadlines, constraints, a step-by-step action plan, and the
  concepts the student needs to understand.
- **Lecture / reading workflow:** concise summary, key concepts, plain-language
  explanations of difficult concepts, and a 5-question study quiz.
- **Explain further:** drill into any single step or concept on demand.
- **My Notes:** a personal notebook that saves in your browser (localStorage).
  Add any RojLearn result to your notes with one click, edit freely, then
  Copy All or download as `.md` / `.txt`. No account, no cloud storage.
- **Input safeguards:** oversized inputs are capped; scanned/image-only
  documents are detected and reported instead of failing silently.
- **Anti-cheating guardrail:** the assistant helps you understand and plan; it
  will not write your essay, solution, or code.

## Architecture

Minimal and serverless. See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.

```
Browser (static SPA)  ->  API Gateway (HTTP API)  ->  AWS Lambda (Python)  ->  Amazon Bedrock (Nova Lite, Converse, us-east-1)
```

Frontend: static site on S3 + CloudFront. Backend: a single Lambda behind an
HTTP API. AI: Amazon Bedrock Nova Lite via the Converse API. The MVP is
stateless — no database.

## How it works

1. **Upload / paste** a course document.
2. **Understand:** RojLearn extracts the text and classifies the document type.
3. **Explain:** it explains the material in plain language.
4. **Plan:** for assignments, it builds a step-by-step action plan and lists the
   concepts to learn.
5. **Study:** for lecture notes/readings, it produces a summary and a quiz; any
   step or concept can be explained further.

## Supported files

MVP: **pasted text, PDF, DOCX, TXT, and Markdown.**

Detected but not yet supported (planned post-hackathon): PPTX, CSV/spreadsheets,
and images/screenshots (OCR). Scanned/image-only PDFs are detected and reported.

## API

The backend is a single Lambda behind an API Gateway HTTP API:

| Method | Path | Purpose |
|---|---|---|
| POST | `/analyze` | Analyze pasted text or an uploaded file |
| POST | `/explain` | Explain a single step/concept further |

Errors use a consistent envelope: `{"error": {"code": "...", "message": "..."}}`.
See [ARCHITECTURE.md](./ARCHITECTURE.md) for request/response shapes.

## Local setup

Requires Python 3.11+ (developed on 3.14).

```bash
# from the repo root
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

# run the tests (uses a fake Bedrock client — no AWS calls)
pytest
```

The backend logic lives in `src/courselens/`. The core entry points are in
`pipeline.py` (`analyze_text`, `analyze_file`, `explain_further`); the Lambda
handler is `courselens.api.handler`.

To run against real Bedrock locally you need AWS credentials with Bedrock access
in `us-east-1`; the model defaults to `amazon.nova-lite-v1:0` and can be
overridden with the `COURSELENS_MODEL_ID` environment variable.

### Run the frontend locally

The frontend is static — no build step.

```bash
cd frontend
python3 -m http.server 8123
# open http://127.0.0.1:8123
```

With `API_BASE_URL` empty in `frontend/config.js`, the app runs in **demo
mode** and returns sample results, so you can exercise the full UI and My Notes
without a backend. To use the real API, set `API_BASE_URL` to the deployed API
base URL (the `ApiBaseUrl` SAM output).

## AWS deployment

RojLearn v1 is deployed and live.

**Backend** (AWS SAM, `template.yaml`):
```bash
sam build --use-container
sam deploy --stack-name courselens --profile courselens \
  --s3-bucket courselens-sam-artifacts-<account> --s3-prefix courselens \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides ExecutionRolePermissionsBoundaryArn=<boundary-arn>
```
Creates an API Gateway HTTP API + one Lambda (`courselens-api`) whose execution
role carries a permissions boundary and only `bedrock:InvokeModel` on
`amazon.nova-*`.

**Frontend** (static site): private S3 bucket (`courselens-web-*`, Block Public
Access on, SSE-S3) served through CloudFront via an Origin Access Control, so
the bucket is never public. HTTPS enforced (`redirect-to-https`), `index.html`
default root object.

All AWS work uses a dedicated, least-privilege deploy identity
(`courselens-deployer` / `--profile courselens`), fully isolated from other
projects. See [ARCHITECTURE.md](./ARCHITECTURE.md) and
[PROJECT_STEPS.md](./PROJECT_STEPS.md).

### Limitations (v1)

- Supported inputs: pasted text, PDF, DOCX, TXT/Markdown (no PPTX, CSV, or
  image/scanned OCR yet).
- `assignment` and `lecture/reading` workflows; syllabus/rubric/dataset are
  classified but analyzed with the study workflow.
- API is public and unauthenticated (rate-limited via API Gateway throttling);
  no accounts, no server-side history.
- My Notes are stored only in your browser (localStorage) — clearing browser
  data clears notes.
- CORS is currently open (`*`); it can be tightened to the CloudFront domain.

## Cost-conscious design

- Serverless, pay-per-request compute (Lambda + API Gateway) with no idle cost.
- Nova Lite, one of the cheapest Bedrock text models; input is size-capped
  before every call.
- No persistent or always-on services (no DynamoDB, RDS, ECS, EC2, etc.).
- Static frontend hosting (S3 + CloudFront) is inexpensive.

### Cost & abuse safeguards

- **API Gateway throttling** (native stage setting, no extra infrastructure):
  conservative 5 req/s with a burst of 10; excess returns HTTP 429.
- **Strict input limits:** 2 MB request/file caps and a 20,000-character input
  truncation before any model call; bounded SDK + app retries.
- **Server-side model control:** the client cannot select the model.
- **Safe errors:** internal/AWS detail is never returned to clients.

### AWS resources used

| Resource | Purpose | Cost model |
|---|---|---|
| API Gateway HTTP API | `/analyze`, `/explain` | per-request (~$1/million) |
| Lambda `courselens-api` | analysis logic | per-request + GB-s (free tier covers demo) |
| Amazon Bedrock (Nova Lite) | the AI | per-token (see below) |
| S3 `courselens-web-*` | static site origin (private) | storage pennies |
| CloudFront distribution | HTTPS delivery | per-request/GB (free tier generous) |
| S3 `courselens-sam-artifacts-*` | deploy artifacts | storage pennies |
| CloudWatch Logs | Lambda logs | negligible at demo volume |

### Verified Nova Lite pricing (us-east-1, on-demand)

From the AWS Price List API: **input $0.06 / 1M tokens**, **output $0.24 / 1M
tokens**. One analysis is two model calls (~1,100 tokens observed).

| Scenario | Per analysis | 100 | 1,000 |
|---|---|---|---|
| Normal | ~$0.0003 | ~$0.03 | ~$0.30 |
| Worst case | ~$0.0024 | ~$0.24 | ~$2.40 |

**Very low usage** is effectively free (Lambda/API Gateway/CloudFront free
tiers; a few cents of Bedrock). Everything is pay-per-use with **no always-on
cost**. Main cost lever is Bedrock tokens, bounded by input truncation and API
throttling. A **$5–$10 AWS Budgets** alert is recommended as a safety net.

## Hackathon information

Built for the **AWS "Zero to Shipped"** hackathon. Region: **us-east-1**. Model:
**Amazon Nova Lite** via the Bedrock **Converse** API. Infrastructure: **AWS
SAM**. Development is logged in [PROJECT_STEPS.md](./PROJECT_STEPS.md).

RojLearn is a standalone project and is kept fully separate from any other
work; all its AWS resources use the internal prefix `courselens`.
