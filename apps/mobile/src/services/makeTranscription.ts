/**
 * Config-gated factory for the transcription service.
 *
 * Returns `undefined` when TRANSCRIBE_BASE_URL is not configured, so
 * createMockServices keeps the honest PendingTranscriptionService (current,
 * unchanged default — audio preserved, no fabricated transcript).
 *
 * When the `rojanda-transcribe` backend is deployed and configured, this builds
 * a RemoteTranscriptionService whose backend calls are SigV4-signed with
 * short-lived per-user Cognito Identity Pool credentials. NO AWS credentials
 * are stored in the app; they are fetched at runtime from the identity pool.
 *
 * The credential/SigV4 assembly is deliberately isolated here and only reached
 * when configured, so the default build carries no AWS SDK dependency.
 */
import type { TranscriptionService } from "@rojanda/api";
import { TRANSCRIBE_BASE_URL, COGNITO_IDENTITY_POOL_ID } from "../config";
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

export function makeTranscription(): TranscriptionService | undefined {
  if (!TRANSCRIBE_BASE_URL || !COGNITO_IDENTITY_POOL_ID) {
    // Not configured -> keep the honest pending default. Nothing AWS loaded.
    return undefined;
  }

  // Deployment-time wiring: obtain per-user Cognito credentials and SigV4-sign
  // each backend request. Assembled lazily so it is only referenced when the
  // backend is actually configured. Implemented at deploy time with the AWS
  // SDK v3 signer + fromCognitoIdentityPool credentials.
  const request: AuthorizedRequest = async () => {
    throw new Error(
      "RemoteTranscriptionService is configured but the Cognito SigV4 signer " +
        "is not assembled yet. Wire the credential provider at deploy time."
    );
  };

  return new RemoteTranscriptionService({ request, readAudioBlob });
}
