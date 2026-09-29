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
