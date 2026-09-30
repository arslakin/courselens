# RojAnda — Production Backend Foundation & Phase 1 Plan

> **Status:** Approved architecture/design + Phase 1 planning. **No code, no AWS,
> no Cognito/IAM, no deploy, no merge, no push.** Starting point is the existing
> `develop/rojanda` work (mobile app + `packages/*` + the reviewed—but not
> deployed—`rojanda-transcribe` SAM backend). This document is authoritative for
> the decisions below; older notes in `rojanda/ARCHITECTURE.md`,
> `rojanda/REAL_DATA_ARCHITECTURE.md`, and `rojanda-backend/DESIGN.md` are
> superseded where they conflict (identity model especially).

Account `387276719593`, region `us-east-1`. Frozen RojLearn (`courselens*`,
`main`, tag `rojlearn-v1`) is never touched.

---

## Approved decisions (summary of what changed)

- **Permanent identity = Amazon Cognito User Pool.** Authoritative `ownerId` =
  the immutable verified **User Pool `sub`**. Backend derives it from verified
  JWT claims; **never** trusts a client-supplied userId/ownerId/email.
- **API authorization = Cognito User Pool JWT authorizer** (HTTP API), not
  AWS_IAM/SigV4 for normal requests.
- **Cognito Identity Pool is REMOVED from the MVP architecture.** With JWT auth +
  backend-issued presigned POST uploads, the client needs no AWS credentials, so
  the Identity Pool and its guest/auth IAM roles are unnecessary infrastructure
  and are dropped. (Revisit only if a future feature needs client-side AWS creds.)
- **No server-side anonymous/guest identities** for persistent data. All
  persistent student data belongs to an authenticated account. A local-only
  try-before-signup demo may come later; it writes nothing to the server.
- **Single DynamoDB table `rojanda-app`**, partitioned by `OWNER#<sub>`; the
  transcription usage/quota accounting folds in without weakening behavior.
- **S3 ownership re-prefixed to `owners/<sub>/…`**, preserving all current
  security properties.
- **AI study coach product name = Rojber** ("Kişisel çalışma rehberin").
  "AI study coach" is internal terminology only.
- **Rojber planning = deterministic planner is authoritative; Bedrock only
  explains/personalizes.** The LLM never invents schedules or facts.

---

## 1. Final authentication architecture

- **Cognito User Pool** (`rojanda-users`): the permanent student directory.
  - Sign-in: **email/password + Google** initially; **Apple** added for iOS
    production readiness (same pool, additional federated IdP — no data change).
  - Federation via Cognito Hosted UI (OAuth) so Google/Apple are configuration,
    not custom code.
  - App clients: one for mobile, one for web (public clients, PKCE; no client
    secret in the app).
- **API Gateway HTTP API + JWT authorizer** bound to the User Pool. Lambda reads
  `ownerId = event.requestContext.authorizer.jwt.claims.sub`.
- **No Identity Pool.** Uploads use a **backend-issued presigned POST** (the
  Lambda holds the S3 permission), so the client never holds AWS credentials.
- Ownership is enforced **server-side** on every operation: `ownerId` comes only
  from the verified token; S3 keys and DynamoDB PKs are built from it; the client
  cannot select another owner.

## 2. Mobile authentication flow (Expo)

1. Sign up / sign in via Cognito (email/password) or Google (Hosted UI / OAuth
   redirect through `expo-auth-session`). Apple later on iOS.
2. Receive ID + access + refresh tokens; store in **`expo-secure-store`**
   (never AsyncStorage for tokens; never AWS keys).
3. Every API request sends `Authorization: Bearer <idToken>`.
4. Silent refresh with the refresh token; on refresh failure → sign-in screen.
5. Replaces the current `MockAuthService` auto-sign-in. The `AuthService`
   interface stays; a `CognitoAuthService` implements it. Screens unchanged.

## 3. Future web authentication flow

- Same Cognito User Pool + a **web app client**. Use Amplify Auth or the Hosted
  UI OAuth code+PKCE flow.
- Store tokens in memory + refresh; prefer httpOnly secure cookies if we add a
  thin web BFF later. Same `Authorization: Bearer <idToken>` to the same API.
- No SigV4, no AWS creds in the browser — the JWT approach makes web a drop-in.

## 4. Exact Phase 1 AWS resources

**New:**
- Cognito **User Pool** `rojanda-users` + domain (Hosted UI) + Google IdP config
  + app clients (mobile, web). (Apple IdP config deferred to iOS readiness.)
- API Gateway **HTTP API** with a **JWT authorizer** (User Pool issuer/audience).
- Lambda `rojanda-api` (Python 3.12, arm64) — the authenticated API handler
  (profile, courses, lessons, transcription routes). May start as the existing
  transcription Lambda extended, or a sibling function; single function is fine
  for Phase 1.
- DynamoDB **single table `rojanda-app`** (on-demand, TTL enabled).
- **Reused:** S3 media bucket (re-prefixed to `owners/<sub>/`), CloudWatch logs,
  SNS cost alarm topic, the IAM execution-role + permissions-boundary pattern.

**Removed vs prior plan:** Cognito **Identity Pool**, its authenticated +
unauthenticated IAM roles, and AWS_IAM API authorization.

**Not needed (avoid):** no RDS, no REST API, no Step Functions, no microservices,
no second bucket.

## 5. DynamoDB key examples (`rojanda-app`, single table)

`PK = OWNER#<sub>` for everything a student owns → every normal read is a
`Query` on one partition (or `Query` with an `SK begins_with` prefix). **No table
scans in normal operation.**

```
PK                     SK                                         (notes)
OWNER#<sub>            PROFILE                                    profile + preferences
OWNER#<sub>            COURSE#<courseId>
OWNER#<sub>            LESSON#<courseId>#<lessonId>               list a course's lessons: SK begins_with LESSON#<courseId>#
OWNER#<sub>            SOURCE#<lessonId>#<sourceId>               photo/pdf/doc/audio/text; original preserved
OWNER#<sub>            TRANSCRIPT#<lessonId>                      editable; pending flag; provenance = sourceId
OWNER#<sub>            NOTE#<noteId>                              typed|voice; optional audioUri; lessonId/courseId attrs
OWNER#<sub>            STUDYSET#<lessonId>                        summary/concepts/explanations (Phase 3)
OWNER#<sub>            FLASHSET#<lessonId>                        flashcards (Phase 3)
OWNER#<sub>            QUIZ#<lessonId>#<quizId>                   generated quiz (Phase 3)
OWNER#<sub>            QUIZATTEMPT#<yyyy-mm-dd>#<attemptId>       history; SK sorts by date
OWNER#<sub>            PROGRESS#SUMMARY                           derived counters (cache)
OWNER#<sub>            USAGE#<yyyy-mm-dd>                         daily transcription minutes (quota gate)
OWNER#<sub>            JOB#<jobName>                              per-job accounting (idempotency; provisional/actual)
OWNER#<sub>            EXAM#<examId>                              exam/deadline (Rojber; never AI-invented)
OWNER#<sub>            GOAL#<goalId>                              study goal (Rojber)
OWNER#<sub>            AVAIL#CURRENT                              availability + preferred session length (Rojber)
OWNER#<sub>            PLAN#<planId>                              study plan (Rojber)
OWNER#<sub>            TASK#<planId>#<taskId>                     study task; refs courseId/lessonId/artifact; completion
OWNER#<sub>            RECO#<planId>#<taskId>                     Rojber recommendation + rationale + provenance
OWNER#<sub>            SUB#CURRENT                                subscription/plan (Phase 5)
```

Common access patterns, all single-partition Queries:
- App load: `Query PK=OWNER#<sub>` (optionally paginated) → everything the app
  needs for that student.
- Course's lessons: `PK=OWNER#<sub>, SK begins_with LESSON#<courseId>#`.
- Today's usage: `GetItem PK=OWNER#<sub>, SK=USAGE#<today>`.
- Quiz history for İlerlemem: `SK begins_with QUIZATTEMPT#`.
- Rojber plan tasks: `SK begins_with TASK#<planId>#`.

TTL attribute on `USAGE#` and `JOB#` rows (self-expire, as today). No GSI for
MVP; add one later only for admin/cross-owner analytics (never student-facing).

## 6. S3 key examples (private bucket, backend-generated keys)

```
owners/<sub>/courses/<courseId>/lessons/<lessonId>/audio/<sourceId>.m4a        # lecture recording
owners/<sub>/courses/<courseId>/lessons/<lessonId>/transcript/<jobName>.json   # Transcribe output
owners/<sub>/courses/<courseId>/lessons/<lessonId>/sources/<sourceId>.<ext>    # photo/pdf/doc (Phase 2)
owners/<sub>/notes/<noteId>/audio/<uuid>.m4a                                    # voice note
owners/<sub>/podcasts/<lessonId>/<uuid>.mp3                                     # Polly (Phase 4)
```
Preserved properties: private bucket, Block Public Access, SSE, TLS-only bucket
policy, **backend-generated keys only**, presigned POST with
`content-length-range` (≤150 MB) enforced by S3 at upload, server-side
`head_object` size re-check, exact-key ownership validation (regex + `<sub>`
match), no client AWS credentials, no cross-user access, 30-day lifecycle on raw
audio.

## 7. JWT request / authorization flow

```
Client --(HTTPS, Authorization: Bearer <idToken>)--> API Gateway
        JWT authorizer verifies issuer (User Pool), audience (app client), exp, sig
   --> Lambda: ownerId = requestContext.authorizer.jwt.claims.sub   (verified)
   --> build all S3 keys / DynamoDB PK from ownerId; validate ownership
   --> 401 if token missing/invalid; 403 if a key/id doesn't belong to ownerId
```
The client-supplied body/query never carries ownership; if it did, it is ignored.

## 8. Account creation / sign-in / sign-out

- **Create:** Cognito sign-up (email + password → email verification code) or
  Google federated sign-up. On first authenticated API call, backend lazily
  creates `OWNER#<sub> / PROFILE` if absent (locale `tr`, default preferences).
- **Sign-in:** Cognito auth → tokens → secure storage. Google via Hosted UI.
- **Sign-out:** clear local tokens; optional Cognito **global sign-out** to
  revoke refresh tokens across devices.

## 9. Account deletion flow (store-release ready)

Authenticated `DELETE /account` performs, in order:
1. Delete all DynamoDB items for `PK=OWNER#<sub>` (batch delete by query).
2. Delete the entire `owners/<sub>/` S3 prefix (sources, recordings, transcripts,
   generated artifacts, podcasts).
3. Delete the Cognito user (admin delete).
4. Return confirmation; app signs out.

**Cannot / should not be instantly deleted (documented honestly):**
- **CloudWatch operational logs** (may contain request metadata, not content):
  retained per the log group's retention window (e.g. 14 days), then auto-expire.
  Not part of the student data store.
- **S3/DynamoDB point-in-time backups** (if enabled later): purged on their
  backup schedule, not instantly.
- **Legal/financial records** (if subscriptions exist in Phase 5): retained as
  legally required, minimized and separated from study content.
Provide an in-app deletion entry point (Apple/Google require it). The deletion is
an auditable server operation; log the deletion event (without content).

## 10. Transcription flow (on authenticated identity)

```
1. POST /transcribe/upload-url (Bearer JWT)
   -> ownerId=sub; server key owners/<sub>/courses/<c>/lessons/<l>/audio/<sourceId>.m4a
   -> presigned POST (content-length-range 1..150MB); return {url, fields, key}
2. client multipart-POSTs the .m4a to S3 (size enforced by S3)
3. POST /transcribe/start { key, courseId, lessonId } (Bearer JWT)
   -> validate key owned by sub; head_object size guard
   -> provisional daily-quota reserve (abuse guard; NOT a plan entitlement)
   -> StartTranscriptionJob tr-TR, MediaFormat mp4, OutputKey under owners/<sub>/...
   -> job name namespaced by sub-hash; write JOB# record {provisional, settled:false}
4. GET /transcribe/status?jobId (Bearer JWT)
   -> verify job belongs to sub; IN_PROGRESS | FAILED(release provisional) |
      COMPLETED(read max(end_time) authoritative duration -> settle usage,
      return transcript + durationSeconds); never fabricated
5. transcript stored under OWNER#<sub>/TRANSCRIPT#<lessonId>; editable
6. sign in on another device -> same sub -> same S3 prefix + same DynamoDB
   partition -> transcript is there (cross-device access).
```

## 11. Exact migration / change list from the existing transcription code

Files today: `rojanda-backend/src/rojanda_transcribe/{core,api}.py`,
`rojanda-backend/template.yaml`, `rojanda-backend/iam/*`,
`rojanda-backend/tests/test_api.py`. Changes required **before first deploy**:

**core.py**
- `get_identity_id(event)` → `get_owner_id(event)` reading
  `requestContext.authorizer.jwt.claims.sub` (verified) instead of
  `authorizer.iam.cognitoIdentity.identityId`. Keep "never from body" rule.
- Identity regex: replace the `us-east-1:<uuid>` identity-id pattern with a
  Cognito `sub` (UUID v4) validator.
- Key builders/validators (`new_audio_key`, `validate_audio_key`,
  `transcript_key_for`, `job_name_for`): change prefix `users/<identityId>/…` →
  `owners/<sub>/courses/<courseId>/lessons/<lessonId>/audio/…`; accept
  courseId/lessonId as validated inputs; ownership check compares embedded `<sub>`.
- `usage_pk` / job records: emit single-table keys (`PK=OWNER#<sub>`,
  `SK=USAGE#<day>` / `JOB#<jobName>`) instead of the standalone `rojanda-usage`
  key shape. **Reconciliation, provisional→authoritative, failure release, and
  idempotency logic are UNCHANGED** — only the key names change.

**api.py**
- Routes stay `/transcribe/upload-url|start|status`; add `courseId`/`lessonId`
  to the request contract and validate them.
- Read `ownerId` from JWT claims; all S3/DynamoDB access under `OWNER#<sub>` /
  `owners/<sub>/`.
- Point the DynamoDB client at `rojanda-app` (or keep `rojanda-usage` for Phase 1
  and fold in during the single-table step — see "deferred").
- Error handling, 500-never-leaks, tr-TR, MediaFormat mp4: unchanged.

**template.yaml**
- Add **User Pool + app clients + Hosted UI domain + Google IdP** (or reference
  them if created out-of-band).
- Replace the HTTP API default authorizer from `AWS_IAM` → **`JWT`** (User Pool
  issuer + audience).
- **Remove** the Cognito Identity Pool + `rojanda-cognito-authenticated-role` /
  `-unauthenticated-role` + role attachment.
- Add the **`rojanda-app` DynamoDB table** (single table); keep or migrate
  `rojanda-usage`.
- Execution role/boundary: keep Logs + Transcribe start/get + S3 on the bucket;
  point DynamoDB permissions at `rojanda-app`.

**IAM (see §12).**

## 12. IAM changes

- **Execution boundary / policy:** unchanged shape — Logs (`/aws/lambda/rojanda-*`),
  `transcribe:StartTranscriptionJob`/`GetTranscriptionJob` (`*`, AWS limitation),
  `s3:GetObject`/`PutObject` on the media bucket, `dynamodb:GetItem`/`PutItem`/
  `UpdateItem`/`Query`/`DeleteItem` on `table/rojanda-app` (add Query + Delete for
  reads and account deletion; still one table).
- **Deploy policy:** add scoped Cognito **User Pool** management
  (`cognito-idp:CreateUserPool`, app clients, domain, IdP — scoped to the rojanda
  pool where ARNs allow); add DynamoDB `CreateTable`/manage for `rojanda-app`.
  **Remove** the Identity-Pool (`cognito-identity:*`) statements and the two
  Cognito role PassRole/attach statements.
- No client-facing IAM roles at all (no Identity Pool). Boundary still
  admin-owned and deny-protected; deployer still cannot escalate.

## 13. Security / isolation analysis

- **Immutable owner:** `sub` from verified JWT; not derivable/forgeable by the
  client. Email changes never change ownership.
- **Isolation before the model:** all data access is scoped by `PK=OWNER#<sub>`
  and `owners/<sub>/` **in the backend authorization/data layer**, before any AI
  context is assembled. Rojber/Bedrock receive only the caller's own rows —
  tenant isolation does not depend on prompt wording.
- **Client cannot select another owner:** no ownerId is accepted from the client;
  attempts to reference another `<sub>`'s key are rejected (403) by the ownership
  check and would fail the partition scoping regardless.
- **Preserved transcription protections:** exact-key regex, ownership check,
  presigned-POST size limit + `head_object`, quota, job-name ownership,
  idempotent reconciliation, failure release — all retained.
- **No client AWS creds; no guest role** → smaller attack surface than the
  Identity-Pool design.
- **JWT authorizer** validates signature/issuer/audience/expiry at the edge.
- **Least privilege + permissions boundary** on the Lambda unchanged.

## 14. Tests to add or change

- **Change (do not regress):** the 27 backend tests currently keyed on guest
  `identityId` → update fixtures to inject a JWT-claims `sub` and `owners/<sub>/`
  keys. The **behavioral assertions stay** (cross-user rejection, path injection,
  oversize, quota, failure release, retry no-double-count, idempotent completion,
  duration precision, tr-TR). Usage-metering behavior must remain identical.
- **Add:** owner derived only from JWT claims (reject body-supplied ownerId);
  cross-owner key rejection under the new `<sub>` prefix; courseId/lessonId
  validation; single-table usage/job round-trip; account-deletion removes all
  `OWNER#<sub>` items + `owners/<sub>/` prefix (mocked S3/DDB).
- **Client:** `CognitoAuthService` token handling (mocked); `RemoteTranscription
  Service` sends `Bearer` token and the new start contract (mocked fetch). Keep
  the 8 existing state-machine tests green.
- No new test framework; reuse stdlib unittest (backend) + ts-jest (client).

## 15. Estimated Phase 1 AWS cost + assumptions

**Standing (fixed) costs:** effectively **$0** — Cognito, DynamoDB on-demand,
Lambda, HTTP API, and S3 have no idle charge at this scale; only CloudWatch logs
carry a tiny standing cost. **Everything else is usage-based.**

**Per-student assumptions (Phase 1 = accounts + transcription only):**
- Transcription: ~**60 min/student/month** (a few lectures). *(The 120-min/day
  cap is an abuse/safety limit, NOT a plan entitlement.)*
- Storage: ~**0.1–0.2 GB/student** of `.m4a` (30-day lifecycle keeps it low).
- API calls: a few hundred/student/month.
- No documents/AI/podcast yet (Phases 2–4).

**Verified unit rates (us-east-1, confirm again at deploy):** Transcribe batch
**$0.006/min**; S3 **$0.023/GB-mo**; DynamoDB on-demand ~$1.25/M writes,
$0.25/M reads; Lambda/HTTP API negligible at this scale; Cognito free ≤50k MAU.

| Scale | Transcribe (min→$) | Storage | DynamoDB+Lambda+API | Cognito | **~Monthly total** |
|---|---|---|---|---|---|
| 10 students | 600 min → $3.60 | ~1.5 GB → $0.04 | < $0.20 | $0 | **~$4** |
| 100 students | 6,000 min → $36 | ~15 GB → $0.35 | < $2 | $0 | **~$40** |
| 1,000 students | 60,000 min → $360 | ~150 GB → $3.45 | < $20 | $0 | **~$385** |

Dominated by Transcribe minutes (linear). No standing cost; ~$0 when idle. These
figures inform later Free/Student plan limits but do **not** set them here.

## 16. How Phase 1 prepares the data model for Rojber

- Every entity is already owned by `sub` and lives in one queryable partition, so
  Rojber can assemble a student's full context with **one `Query PK=OWNER#<sub>`**
  — no cross-entity joins, no scans.
- Phase 1 lands the entities Rojber consumes: courses, lessons, transcripts, and
  (from the existing model) quiz attempts + progress. The Rojber-specific SKs
  (`EXAM#`, `GOAL#`, `AVAIL#`, `PLAN#`, `TASK#`, `RECO#`) are **reserved in the
  key design now** so adding them later needs no migration.
- `TASK#` references real `courseId`/`lessonId`/artifact ids (not free text), so
  the deterministic planner can point at actual RojAnda entities from day one of
  Phase 3.
- Provenance fields on artifacts + the known-data-vs-assumption flag on
  recommendations are part of the model, so Rojber can label facts vs AI
  suggestions without a schema change.

## 17. Deliberately deferred (not in Phase 1)

- Photo/PDF/document **extraction** (Phase 2).
- Grounded Turkish AI: summary/concepts/flashcards/quizzes/chat + **Rojber MVP**
  (Phase 3) — Rojber needs quiz/flashcard data that Phase 3 produces.
- Turkish **podcast** generation / Polly (Phase 4).
- Subscriptions/plan enforcement, **calendar integration**, broader analytics,
  advanced Rojber adaptation (Phase 5).
- **Apple sign-in** (add for iOS production readiness, after Google).
- **Single-table consolidation of `rojanda-usage`**: acceptable to keep the
  existing `rojanda-usage` table for the first Phase 1 cut and fold it into
  `rojanda-app` within Phase 1, provided quota/idempotency tests stay green.
- Web client build (architecture is ready; implementation later).
- Any local try-before-signup demo (server writes nothing; later, optional).

---

## Rojber (AI study coach) — reference for Phases 3+ (design locked now)

Product name **Rojber** ("Kişisel çalışma rehberin"); "AI study coach" is
internal only.

**Architecture (authoritative planner; LLM explains only):**
```
authoritative student data (one Query on OWNER#<sub>)
  + deterministic planning constraints (exam dates, days remaining, available
    minutes, max session length, breaks, unfinished work, weak quiz areas,
    flashcard review needs, priority/urgency, completed work)
        ↓ deterministic planner (backend, pure logic)
  candidate study plan (StudyTasks linked to course→lesson→artifact)
        ↓ Amazon Bedrock (Turkish explanation/personalization ONLY)
  rationale per task; encouragement; adjust-within-constraints
        ↓
  student accepts / edits / completes / skips / reschedules
        ↓ completion + measured performance feed the next deterministic run
```

**Hard rules:** Rojber never invents exams, deadlines, grades, completed
activities, available time, quiz results, or progress. Missing key info → it asks
or clearly labels the assumption. Bedrock is stateless per request and only ever
receives the caller's own data (isolation enforced in the data layer, not the
prompt).

**Rojber MVP (Phase 3):** exam/deadline + available time + courses/lessons +
quiz/flashcard progress → a personalized daily/weekly plan of linked StudyTasks
with Turkish rationale. Worked example (6-day math exam, 90 min tonight, weak
Türev quiz, flashcards due): 35 min Türev lesson review · 15 min flashcards ·
10 min break · 20 min short quiz/practice · 10 min review incorrect — with an
explanation of why each was prioritized.

**Calendar (Phase 5, design-ready):** `Availability`/`StudyTask` carry optional
`scheduledStart/End` + `externalCalendarEventId` so RojAnda can later read
free/busy, propose blocks, write accepted sessions, and reschedule missed ones —
no MVP dependency, no calendar permissions requested now.


---

# Turkey Deployment and Scalability

RojAnda's initial target users are students in **Turkey**; the architecture must
support students in other countries later without redesign. This section is
documentation only — no region is created, nothing is deployed.

> Region-availability facts below were verified against current AWS sources
> (Nov 2026): an **AWS Local Zone in Istanbul** exists (GA May 2026) but there is
> **no full AWS Region in Turkey**; Amazon **Transcribe supports Turkish in
> Europe (Frankfurt)**; Amazon **Bedrock offers Amazon Nova in `eu-central-1`**
> (via cross-region inference profiles) with an **EU data-residency** routing
> option. *Content from AWS docs was rephrased for compliance.*

## 1. How students access RojAnda

Production request path (no AWS knowledge or credentials on the student side):

```
iOS app / Android app / (future) web app
   → public Internet (HTTPS/TLS)
   → RojAnda public HTTPS API (API Gateway custom domain, e.g. api.rojanda.app)
   → JWT authorizer (Cognito User Pool) verifies the student's token
   → Lambda backend (ownerId = verified sub) → DynamoDB / S3 / Transcribe / Bedrock
```

- **App Store (iOS) users:** download RojAnda, sign in with email/password,
  Google, or Apple (Apple at iOS production readiness). The app calls the public
  HTTPS API with a Cognito JWT. Students never see AWS, never hold AWS creds.
- **Google Play (Android) users:** identical — email/password or Google sign-in,
  JWT to the same public API.
- **Future web users:** same Cognito User Pool + a web app client; browser calls
  the same public HTTPS API with a JWT. No SigV4, no AWS creds in the browser.

The fact that the backend runs on AWS is an implementation detail invisible to
students. Only a public HTTPS API + Cognito Hosted UI domain are exposed.

## 2. AWS region decision

The current prototype was designed around `us-east-1`; that is **not** assumed
correct for a Turkey launch. There is **no AWS Region in Turkey** (only an
Istanbul **Local Zone**, which is a compute/storage extension of a parent
region — it does not host Cognito/DynamoDB/Transcribe/Bedrock and is not a
region choice). So the decision is the nearest **full region** in Europe.

Candidates evaluated (Turkey-proximate full regions): **`eu-central-1`
(Frankfurt)**, `eu-south-1` (Milan), `eu-west-1` (Ireland).

| Factor | `eu-central-1` Frankfurt | `eu-south-1` Milan | `us-east-1` N. Virginia |
|---|---|---|---|
| Latency from Turkey | Low (closest mature hub; ~30–50 ms) | Low (geographically near) | High (~120–150 ms transatlantic) |
| Cognito, API GW, Lambda, DynamoDB, S3 | Yes (mature) | Yes | Yes |
| Transcribe + Turkish `tr-TR` | **Yes (Frankfurt listed)** | Verify (not confirmed) | Yes |
| Bedrock + Amazon Nova | **Yes (Nova via inference profiles; EU data residency)** | Limited/verify | Yes (broadest) |
| Future OCR (Textract) | Yes | Verify | Yes |
| Future TTS (Polly, Turkish voice) | Yes | Verify | Yes |
| Data residency (EU/KVKK-friendly) | **EU, strong** | EU | US (transatlantic transfer) |
| Pricing vs us-east-1 | Slightly higher (~single-digit %) | Similar | Baseline (often cheapest) |
| Service breadth / quotas | Very broad | Narrower | Broadest |

**Recommendation: launch in `eu-central-1` (Frankfurt).** It is the closest
mature full region to Turkey that actually has **every** service RojAnda needs —
Cognito, API Gateway, Lambda, DynamoDB, S3, Transcribe with Turkish, and Bedrock
with Amazon Nova (plus Textract/Polly for later phases) — with EU data residency
that fits Turkish student expectations far better than a US region. Milan is a
viable fallback but has narrower AI-service confirmation; Ireland is a safe
secondary if a specific Frankfurt quota/feature is missing. The small pricing
premium over `us-east-1` is worth the latency and residency benefits.

**Action for Phase 1:** parameterize the region (SAM parameter / env), default
**`eu-central-1`**, and re-verify Transcribe-tr-TR + the exact Bedrock model IDs
(and their inference-profile requirement) in Frankfurt at deploy time before
committing. Do not hardcode `us-east-1`.

**Multi-region: NOT needed for the MVP.** A single region (Frankfurt) is correct
for beta and well beyond. We will not build multi-region infrastructure for
theoretical scale. (Revisit only if we later need cross-geo residency or DR — see
growth checkpoints.)

## 3. Scalability of the serverless architecture

Serverless scales well but is **not** unlimited — every managed service has
soft/hard quotas. Behavior by size (steady beta usage):

- **10 students:** trivially within all defaults. Nothing to tune.
- **100 students:** still within defaults. Watch Transcribe concurrent jobs only
  if many record at once.
- **1,000 students:** fine on defaults for API/Lambda/DynamoDB (on-demand).
  Transcribe concurrent-job quota and Bedrock TPM/RPM (when introduced) are the
  first things to monitor at peak.
- **10,000 students:** likely need **quota increases** (Lambda concurrency,
  Transcribe concurrent jobs, Bedrock tokens/requests) and to confirm DynamoDB
  partition access stays balanced. Still no architectural change if access
  patterns hold.
- **100,000 students:** requires proactive quota management and probably an
  **async queue** (SQS) in front of Transcribe/OCR/AI workers, request smoothing,
  and cost controls per tier. Data model (per-`sub` partitions) still holds.

### A. Scales with little intervention
- **S3** (effectively unlimited object storage/throughput per prefix; our keys
  are per-`sub` so no hot prefix).
- **DynamoDB on-demand** with `PK=OWNER#<sub>` — load is spread across many
  partitions by design; no single hot partition in normal use.
- **Lambda** (auto-scales to the account concurrency limit).
- **API Gateway HTTP API** (scales to its throttle limits).
- **Cognito** (handles large MAU; free ≤50k MAU).

### B. Needs quota monitoring / increases
- **Lambda concurrency** (account-wide default ~1,000; request increases as we
  grow).
- **Transcribe concurrent transcription jobs** (soft quota; the first real
  ceiling for a recording-heavy product).
- **Bedrock requests/tokens per minute** (per-model quotas; matters from Phase 3).
- **API Gateway throttle** (raise steady-state/burst as traffic grows).
- **DynamoDB on-demand throughput** (very high default, but monitor for throttles
  / consider provisioned+autoscaling at large scale).

### C. May eventually need architectural change
- **Transcribe / OCR / AI as async workers behind a queue (SQS + worker Lambda)**
  once concurrent jobs or burstiness exceed comfortable synchronous handling
  (see §4).
- **Bedrock throughput**: batching, caching, smaller models, or provisioned
  throughput if token volume grows.
- **Hot-partition risk** only if we later add cross-owner access patterns; would
  need a GSI or rethought keys (not the case for per-student access today).

## 4. Async job architecture

**Phase 1 does NOT need SQS.** The current design (client → `/start` → Lambda →
`StartTranscriptionJob` → client polls `/status`) is already effectively async:
Transcribe runs the job out-of-band and the client polls. There is no
long-running work held inside a Lambda invocation, so no queue is required for a
beta. Adding SQS now would be unnecessary infrastructure.

**Evolution path (design it, don't build it):**
```
upload → job record (DynamoDB) → SQS queue → worker Lambda
       → Transcribe / OCR / AI → result (S3/DynamoDB) → status/notification
```
**When a queue becomes useful:** when we need to (a) cap/smooth **concurrent
Transcribe/OCR/Bedrock jobs** below their quotas under bursty load, (b) add
ret/backoff and dead-letter handling for failed jobs at volume, or (c) fan work
to multiple workers. Concretely: around **10,000+ active students** or whenever
peak concurrent jobs approach the Transcribe quota. Because `/start` already
writes a per-job record and `/status` reads job state, inserting SQS later is a
localized change (enqueue in `/start`, a worker drains the queue) — no client or
data-model change.

## 5. Cost protection

Scalability is tied to cost control. Layered defenses so a bug or abusive client
cannot create runaway AWS charges:

- **Per-user daily transcription limit** — the existing **120 min/day** ceiling
  (conditional DynamoDB write). **This is an abuse/safety ceiling, NOT a
  subscription entitlement.**
- **Max recording duration** — 90 min/recording (client + server enforced).
- **Upload size limit** — presigned-POST `content-length-range` ≤150 MB,
  enforced by S3 at upload + server `head_object` re-check.
- **API throttling** — API Gateway steady-state/burst limits → HTTP 429.
- **Usage metering** — provisional→authoritative reconciliation records real
  usage per `sub` (basis for future plan limits; not itself a limit).
- **Bedrock token/request limits (Phase 3+)** — per-request max tokens, scoped
  context (see §8), per-user/day request cap, small models where sufficient.
- **Retry limits** — bounded client polling/backoff; failed jobs release their
  provisional reservation (never charged) and are retryable, not auto-looping.
- **CloudWatch alarms** — the existing `$25` `EstimatedCharges` alarm; add
  Transcribe-minutes and Bedrock-token alarms as those grow.
- **AWS Budgets / billing alerts** — set an account monthly budget with email
  alerts at, e.g., 50/80/100% for the beta; escalate thresholds as scale grows.

Together these bound worst-case spend even under a client bug: per-user daily
cap × active users is the theoretical ceiling, and alarms/budgets catch anomalies
early.

## 6. Observability (minimum for beta)

Use **AWS-native** monitoring (CloudWatch metrics/alarms/dashboards +
Logs Insights). No custom analytics platform for Phase 1. Watch:

- **Active users** (Cognito sign-ins / DAU-MAU).
- **API request count, error rate (4xx/5xx), p50/p95 latency** (API Gateway).
- **Lambda errors, throttles, duration, concurrency** (CloudWatch).
- **Transcription jobs started / completed / failed** and **transcription
  minutes** (custom metric emitted at settle; drives cost).
- **Upload / storage volume** (S3 metrics, bucket size).
- **DynamoDB consumed capacity + throttled requests**.
- **Bedrock requests / tokens** (when Phase 3 lands) and **Rojber usage**
  (recommendations generated, acceptance rate) when introduced.
- **Estimated AWS cost per active student** (billing ÷ active users) — the north-
  star efficiency metric for plan design.

A single CloudWatch dashboard + a handful of alarms (errors, latency, Transcribe
minutes, estimated charges) is sufficient for beta.

## 7. Growth checkpoints

Explicit review gates. The goal is a sensible evolution path, not building for
100k today.

- **→ 10 (beta):** measure real transcription minutes/student, error rate,
  cost/student. Validate the model + quotas defaults hold. No change expected.
- **→ 100:** watch Transcribe concurrent jobs at peak, API errors, cost/student
  trend. Confirm no DynamoDB throttling. Likely no change.
- **→ 1,000:** review Lambda concurrency headroom, Transcribe job quota, API
  throttle settings; tune alarms/budgets. Decide plan limits from measured usage.
  Probably still no architectural change.
- **→ 10,000:** request quota increases (Lambda, Transcribe, Bedrock); evaluate
  introducing **SQS** workers for transcription/OCR/AI; confirm partition access
  is balanced. Possible provisioned DynamoDB.
- **→ 100,000:** async queue workers likely required; formal quota management;
  consider caching/batching for Bedrock; revisit region strategy/DR only if
  business needs it. Data model (per-`sub`) still holds.

At each gate: **measure before changing.** Decisions are driven by observed
metrics (§6), not speculation.

## 8. Rojber scaling

Rojber (Phases 3+) is the main new cost/scale variable because it calls Bedrock.
Controls, built into the design:

- **Never send the student's entire history to Bedrock.** The backend selects a
  **structured, scoped context** for the authenticated `sub` before any model
  call:
  ```
  student (sub)
    → relevant courses (only those tied to the active goal/exam)
    → upcoming deadlines/exams
    → current availability + preferred session length
    → recent progress (recent quiz attempts, flashcard due items)
    → weak topics (derived server-side)
    → current study plan (if any)
  ```
- **Deterministic scheduling stays outside the LLM** — the planner computes the
  candidate plan; Bedrock only explains/personalizes a compact plan object. This
  keeps prompts small (bounded tokens), cheap, and predictable regardless of how
  much history a student accumulates.
- **Per-request token cap + per-user/day Rojber request limit** to bound spend.
- **Isolation before the model:** context is assembled by a `Query
  PK=OWNER#<sub>` in the data layer; Bedrock is stateless per request and never
  receives another student's data. Isolation does not rely on prompt wording.
- Cost therefore scales with **active Rojber interactions**, not with data size —
  a student with a huge history costs the same per recommendation as a new one.

---

## Impact of this analysis on the Phase 1 plan

1. **Region:** change the default target region in the Phase 1 plan from
   `us-east-1` to **`eu-central-1` (Frankfurt)**; make it a SAM parameter and
   re-verify Transcribe-tr-TR + exact Bedrock/Nova model IDs (and inference-
   profile requirement) in Frankfurt at deploy time. All S3/DynamoDB/Cognito/
   Transcribe references become region-parameterized, not hardcoded.
2. **No SQS in Phase 1** — the poll-based transcription flow is sufficient; the
   queue is a documented future step, added around 10k+ students.
3. **Add AWS Budgets + a couple of CloudWatch alarms** (Transcribe minutes,
   estimated charges) to Phase 1's cost-protection scope alongside the existing
   `$25` alarm — small, native, no new infra.
4. **Bedrock/Rojber scoped-context rule** is recorded now so the Phase 3 data
   access is designed for it from the start (Phase 1 already stores everything
   under one queryable `OWNER#<sub>` partition, which enables it).
5. No change to the identity model, single-table design, S3 key shape, or the
   transcription migration list — only the **region** and **cost-alarm/budget**
   items are updated.
