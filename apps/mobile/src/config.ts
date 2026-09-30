/**
 * RojAnda mobile configuration.
 *
 * All values are sourced from the environment (Expo public env vars) with safe
 * empty defaults, so no Cognito ids, secrets, domains, URLs, or AWS credentials
 * are hardcoded in the source. Set these via `.env` / EAS build env at deploy.
 */

/** Read an Expo public env var (EXPO_PUBLIC_*), defaulting to "". */
function env(name: string): string {
  // process.env.EXPO_PUBLIC_* is inlined by the Expo/Metro bundler at build time.
  const v = (process.env as Record<string, string | undefined>)[name];
  return typeof v === "string" ? v : "";
}

/**
 * ANALYSIS_BASE_URL: base URL of the deployed RojAnda backend that performs the
 * server-side AI steps (OCR, Turkish Bedrock analysis, Transcribe, Polly).
 * Empty = use the local, offline, grounded analysis implementation (default
 * for development). No secrets live here — the app authenticates with a
 * per-user JWT at runtime; it never holds AWS credentials.
 */
/**
 * API_BASE_URL: base URL of the deployed RojAnda HTTP API (profile/course/
 * lesson persistence). Empty = local in-memory persistence (development). When
 * set (with Cognito configured) the app uses authenticated API-backed
 * repositories. Requests carry a Cognito User Pool JWT; no AWS credentials.
 */
export const API_BASE_URL = env("EXPO_PUBLIC_API_BASE_URL");

export const ANALYSIS_BASE_URL = env("EXPO_PUBLIC_ANALYSIS_BASE_URL");

/**
 * TRANSCRIBE_BASE_URL: base URL of the deployed `rojanda-transcribe` backend
 * (Amazon Transcribe tr-TR). Empty = use the honest PendingTranscriptionService
 * (default; audio preserved, no fabricated transcript). When the backend is
 * deployed, set this and the app uses RemoteTranscriptionService — no screen
 * changes. No AWS credentials here; requests carry a Cognito User Pool JWT
 * (`Authorization: Bearer <idToken>`), not AWS credentials or SigV4.
 */
export const TRANSCRIBE_BASE_URL = env("EXPO_PUBLIC_TRANSCRIBE_BASE_URL");

/**
 * Cognito User Pool config for authentication (Phase 1A). The permanent student
 * identity system. Empty until configured; no ids are hardcoded. The
 * authoritative ownerId is the verified `sub` derived by the BACKEND from the
 * JWT — never asserted by the client.
 */
export const COGNITO = {
  region: env("EXPO_PUBLIC_COGNITO_REGION"), // e.g. eu-central-1
  userPoolId: env("EXPO_PUBLIC_COGNITO_USER_POOL_ID"),
  userPoolClientId: env("EXPO_PUBLIC_COGNITO_APP_CLIENT_ID"),
  /** OAuth/Hosted-UI domain for Google/Apple federation (later phases). */
  hostedUiDomain: env("EXPO_PUBLIC_COGNITO_HOSTED_UI_DOMAIN"),
} as const;

/** True when the Cognito User Pool is fully configured for production auth. */
export const isCognitoConfigured =
  COGNITO.region !== "" && COGNITO.userPoolId !== "" && COGNITO.userPoolClientId !== "";

/**
 * AUTH_MODE controls which client auth provider is used.
 *  - "cognito": production Cognito User Pool auth (requires isCognitoConfigured).
 *  - "mock": local development auth ONLY (never allowed to act as production).
 * Defaults to "mock" for local dev. Production builds MUST set
 * EXPO_PUBLIC_AUTH_MODE=cognito with the Cognito config above.
 */
export const AUTH_MODE = (env("EXPO_PUBLIC_AUTH_MODE") || "mock") as "cognito" | "mock";
