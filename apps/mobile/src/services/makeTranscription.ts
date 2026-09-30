/**
 * Config-gated factory for the transcription service.
 *
 * Returns `undefined` when TRANSCRIBE_BASE_URL is not configured (or Cognito
 * auth isn't configured), so createMockServices keeps the honest
 * PendingTranscriptionService (current, unchanged default — audio preserved, no
 * fabricated transcript).
 *
 * Phase 1A: backend calls are authorized with a Cognito User Pool **JWT**
 * (`Authorization: Bearer <idToken>`), NOT SigV4 and NOT Identity Pool AWS
 * credentials. The app never holds AWS credentials. The backend derives the
 * owner from the verified `sub`.
 */
import type { TranscriptionService } from "@rojanda/api";
import { TRANSCRIBE_BASE_URL, isCognitoConfigured } from "../config";
import {
  RemoteTranscriptionService,
  type AuthorizedRequest,
  type ReadAudioBlob,
} from "./RemoteTranscriptionService";

/** Reads a local file URI into a Blob via fetch (works in Expo/RN for file://). */
const readAudioBlob: ReadAudioBlob = async (uri: string) => {
  const res = await fetch(uri);
  return res.blob();
};

/**
 * Build a JWT-authorized request function bound to a token getter (from the
 * auth provider). Attaches `Authorization: Bearer <idToken>`; no AWS creds.
 */
export function makeAuthorizedRequest(
  baseUrl: string,
  getIdToken: () => Promise<string | null>
): AuthorizedRequest {
  const base = baseUrl.replace(/\/$/, "");
  return async (path, init) => {
    const token = await getIdToken();
    if (!token) {
      // No valid session -> do not send an unauthenticated request that could
      // be mistaken for an authenticated one. Fail closed.
      return { ok: false, status: 401, json: { error: { code: "unauthorized" } } };
    }
    const res = await fetch(base + path, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  };
}

/**
 * @param getIdToken supplies a valid Cognito JWT (from the AuthProvider). When
 * transcription identity is wired end-to-end (Phase 1B), ServicesProvider passes
 * the provider's getIdToken here.
 */
export function makeTranscription(
  getIdToken?: () => Promise<string | null>
): TranscriptionService | undefined {
  if (!TRANSCRIBE_BASE_URL || !isCognitoConfigured || !getIdToken) {
    // Not configured -> keep the honest pending default. Nothing remote loaded.
    return undefined;
  }
  const request = makeAuthorizedRequest(TRANSCRIBE_BASE_URL, getIdToken);
  return new RemoteTranscriptionService({ request, readAudioBlob });
}
