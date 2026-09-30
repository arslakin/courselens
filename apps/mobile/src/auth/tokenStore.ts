/**
 * Secure session storage for RojAnda auth tokens (Phase 1B).
 *
 * Uses expo-secure-store (Keychain on iOS, Keystore on Android) so refresh/ID
 * tokens are stored in the OS secure store, never in AsyncStorage or plain
 * files. Only the tokens + expiry are persisted; never AWS credentials.
 *
 * expo-secure-store is a bundled SDK 57 module (Expo Go compatible).
 */
import * as SecureStore from "expo-secure-store";

const KEY = "rojanda.auth.session.v1";

/** Persisted session material. `idToken` is the JWT sent to the API. */
export interface StoredSession {
  idToken: string;
  accessToken?: string;
  refreshToken?: string;
  /** Epoch ms when idToken expires. */
  expiresAt: number;
  /** Cognito sub — informational on the client (display/routing only). */
  sub: string;
  email?: string;
}

export async function saveSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function loadSession(): Promise<StoredSession | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as StoredSession;
    if (!s || typeof s.idToken !== "string" || typeof s.expiresAt !== "number") return null;
    return s;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
