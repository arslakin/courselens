# RojAnda transcription backend — design notes

Isolated `rojanda-transcribe` stack. No AWS credentials in the client. Per-user
isolation via Cognito identity + server-derived S3 keys. Turkish `tr-TR` batch
transcription. Nothing here touches the frozen RojLearn/courselens stack.

## Upload-size enforcement (verified against boto3)

**Verified:** a plain presigned `PUT` (`generate_presigned_url('put_object')`)
does NOT reliably enforce a maximum object size. Only the S3 **POST policy**
form (`generate_presigned_post`) supports a signed, S3-enforced
`content-length-range` condition
([botocore docs](https://docs.aws.amazon.com/botocore/latest/reference/services/s3/client/generate_presigned_post.html)).
*Content rephrased for compliance with licensing restrictions.*

Therefore the backend issues uploads via **`generate_presigned_post`** with:
```python
conditions = [["content-length-range", 1, MAX_UPLOAD_BYTES]]   # e.g. 1 .. 150 MB
fields     = {"Content-Type": "audio/m4a"}
# Key is server-generated: users/<derivedIdentityId>/audio/<uuid>.m4a
```
This is a **presigned POST** (multipart form upload), NOT a presigned PUT. S3
enforces the `content-length-range` as a signed POST-policy condition and
rejects an over-range upload at upload time with `EntityTooLarge` — a real,
enforced ceiling.

**Belt-and-suspenders (also implemented):** before starting Transcribe, the
Lambda calls `head_object` on the uploaded key and rejects if `ContentLength`
exceeds `MAX_UPLOAD_BYTES`. So size is enforced even if the upload path ever
changes. Client is a multipart POST (supported by expo-file-system upload).

Duration cap: `MAX_AUDIO_SECONDS = 5400` (90 min) enforced client-side (recorder
cap); the size ceiling is the hard pre-Transcribe guard.

## Usage metering: provisional (guard) → authoritative (Transcribe)

We must never record the size-derived estimate as actual student usage, because
usage will feed RojAnda Free/Student pricing later. So we separate the up-front
abuse guard from the authoritative accounting.

**Authoritative duration = `max(end_time)`** across the Amazon Transcribe output
items. This is produced server-side by AWS and is never client-supplied.

> IMPORTANT semantics: `max(end_time)` is the recognized-transcription duration
> **through the final recognized token**, NOT the exact media-container
> wall-clock length. Audio with trailing silence after the last word measures
> slightly SHORT of raw file duration. This is intentional for the MVP
> (student-favorable, no ffprobe/Lambda layer) and is what pricing/analytics
> should treat as usage. `durationSeconds` is stored with second-level precision;
> rounded-UP minutes are used only where the quota system needs minutes.

### Storage (one small DynamoDB table `rojanda-usage`, PAY_PER_REQUEST, TTL)
Two record kinds:
- **Day counter** `pk = "<identity>#YYYY-MM-DD"`, attr `minutes`, `ttl` ~2 days.
  This is the quota gate.
- **Per-job record** `pk = "<identity>#job#<jobName>"`, attrs `provisional`,
  `settled` (bool), `actualMinutes`, `durationSeconds`, `ttl` ~35 days. Enables
  idempotent reconcile/release and retry-safety.

### Lifecycle
1. **/start** — compute `provisional` minutes from file size (rounded up, clamped
   to 90). This is a PROVISIONAL abuse guard ONLY. Atomically `ADD` it to the day
   counter with a condition that stays within `DAILY_MINUTES_ALLOWANCE`
   (**120 min/identity/day**); 429 on exceed (audio preserved, no Transcribe
   call). Write the per-job record `{provisional, settled:false}`. Each start —
   including a retry — gets its OWN job + record.
2. **/status COMPLETED** — read `durationSeconds = max(end_time)`, compute
   `actualMinutes = ceil(seconds/60)`, then **settle once** (conditional on
   `settled=false`): store actuals and adjust the day counter by
   `actual - provisional`. Repeated polls are idempotent (no double-count).
3. **/status FAILED** — **release once** (conditional): subtract the provisional
   from the day counter and mark `settled` with `actualMinutes=0`. A failed job
   is never permanently charged as usage; audio preserved; client may retry.
4. **Retry** — a fresh job/record; if the first failed it was already released,
   so only the successful attempt's authoritative minutes count. The same audio
   is never permanently counted twice.

Rejected alternatives: Transcribe `ListTranscriptionJobs` (not granted; noisy),
API-key usage plans (more infra), in-memory counters (not durable), ffprobe for
exact wall-clock (needs a Lambda layer — explicitly out of scope).

This caps cost amplification per identity (≤120 provisional min/day) on top of
the account-wide $25 alarm and API throttling, while metering true usage.

## Identity model (guest now, mappable to accounts later)

- MVP uses Cognito **guest (unauthenticated)** identities: each device gets a
  stable identity id, its own S3 prefix, and its own usage counter — no account
  system needed to test.
- Upgrade path: add a Cognito **User Pool** as an authenticated provider on the
  SAME identity pool. Authenticated users receive identity ids in the same pool;
  the authenticated role already exists with identical minimal permissions. A
  guest identity can be linked to a signed-in account so prior data carries over.
- Both roles hold ONLY `execute-api:Invoke` on `/transcribe/*` — no direct S3.

## Endpoints (unchanged shape; POST-policy upload)

```
POST /transcribe/upload-url  -> { url, fields, audioKey }   # presigned POST (size-limited)
POST /transcribe/start       -> { jobId, status:"IN_PROGRESS" }  # after head_object + daily check
GET  /transcribe/status      -> { status, transcript?, confidenceAvg?, error? }
```
All `AWS_IAM`-authed; `userId` = verified `requestContext.identity.cognitoIdentityId`;
keys validated `^users/<derivedId>/audio/[A-Za-z0-9._-]+\.m4a$`.
