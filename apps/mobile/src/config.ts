/**
 * RojAnda mobile configuration.
 *
 * ANALYSIS_BASE_URL: base URL of the deployed RojAnda backend that performs the
 * server-side AI steps (OCR, Turkish Bedrock analysis, Transcribe, Polly).
 * Empty = use the local, offline, grounded analysis implementation (default
 * for development). No secrets live here — the app authenticates with a
 * per-user token at runtime; it never holds AWS credentials.
 */
export const ANALYSIS_BASE_URL = "";

/**
 * TRANSCRIBE_BASE_URL: base URL of the deployed `rojanda-transcribe` backend
 * (Amazon Transcribe tr-TR). Empty = use the honest PendingTranscriptionService
 * (default; audio preserved, no fabricated transcript). When the backend is
 * deployed, set this and the app uses RemoteTranscriptionService — no screen
 * changes. No AWS credentials here; requests are signed at runtime with
 * short-lived per-user Cognito Identity Pool credentials.
 */
export const TRANSCRIBE_BASE_URL = "";

/** Cognito Identity Pool id used to obtain short-lived, per-user credentials.
 * Empty until the backend is deployed. Never contains AWS secrets. */
export const COGNITO_IDENTITY_POOL_ID = "";
