/**
 * RojAnda mobile configuration.
 *
 * All values are sourced from the environment (Expo public env vars) with safe
 * empty defaults, so no Cognito ids, secrets, domains, URLs, or AWS credentials
 * are hardcoded in the source. Set these via `.env` / EAS build env at deploy.
 *
 * IMPORTANT (Expo/Metro env inlining): `EXPO_PUBLIC_*` vars are only inlined
 * into the bundle when referenced STATICALLY as `process.env.EXPO_PUBLIC_NAME`.
 * A dynamic/computed lookup like `process.env[name]` is NOT statically
 * analyzable, so it is left un-substituted and resolves to `undefined` in
 * production (export/release) builds — which would silently blank the config.
 * Every value below therefore uses a direct, static reference.
 */

/** Normalize a possibly-undefined inlined env value to a string ("" if unset). */
function val(v: string | undefined): string {
  return typeof v === "string" ? v : "";
}

/**
 * API_BASE_URL: base URL of the deployed RojAnda HTTP API (profile/course/
 * lesson persistence). Empty = local in-memory persistence (development). When
 * set (with Cognito configured) the app uses authenticated API-backed
 * repositories. Requests carry a Cognito User Pool JWT; no AWS credentials.
 */
export const API_BASE_URL = val(process.env.EXPO_PUBLIC_API_BASE_URL);

/**
 * ANALYSIS_BASE_URL: base URL of a backend that performs server-side AI steps
 * (OCR / Turkish Bedrock analysis). Empty = use the local, offline, grounded
 * analysis implementation (default). No secrets here; auth is a per-user JWT.
 */
export const ANALYSIS_BASE_URL = val(process.env.EXPO_PUBLIC_ANALYSIS_BASE_URL);

/**
 * TRANSCRIBE_BASE_URL: base URL of the deployed backend that serves the
 * `/transcribe/*` routes (Amazon Transcribe tr-TR). Empty = use the honest
 * PendingTranscriptionService (default; audio preserved, no fabricated
 * transcript). When set, the app uses RemoteTranscriptionService. Requests
 * carry a Cognito User Pool JWT (`Authorization: Bearer <idToken>`), never AWS
 * credentials or SigV4.
 */
export const TRANSCRIBE_BASE_URL = val(process.env.EXPO_PUBLIC_TRANSCRIBE_BASE_URL);

/**
 * Cognito User Pool config for authentication (Phase 1A). The permanent student
 * identity system. Empty until configured; no ids are hardcoded. The
 * authoritative ownerId is the verified `sub` derived by the BACKEND from the
 * JWT — never asserted by the client.
 */
export const COGNITO = {
  region: val(process.env.EXPO_PUBLIC_COGNITO_REGION), // e.g. eu-central-1
  userPoolId: val(process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID),
  userPoolClientId: val(process.env.EXPO_PUBLIC_COGNITO_APP_CLIENT_ID),
  /** OAuth/Hosted-UI domain for Google/Apple federation (later phases). */
  hostedUiDomain: val(process.env.EXPO_PUBLIC_COGNITO_HOSTED_UI_DOMAIN),
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
export const AUTH_MODE = (val(process.env.EXPO_PUBLIC_AUTH_MODE) || "mock") as "cognito" | "mock";
