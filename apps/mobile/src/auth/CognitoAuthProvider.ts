/**
 * CognitoAuthProvider — production authentication against a Cognito User Pool
 * (Phase 1B, real implementation).
 *
 * Uses the lightweight direct-JSON Cognito client (cognitoApi) + secure token
 * storage (tokenStore). No Amplify, no AWS SDK v3, no crypto/stream polyfills,
 * no native auth module -> Expo Go + web compatible. See the auth-SDK decision
 * in rojanda/PRODUCTION_PHASE1_PLAN.md.
 *
 *  - email/password sign-up + confirmation + sign-in (USER_PASSWORD_AUTH)
 *  - session restore + refresh (REFRESH_TOKEN_AUTH)
 *  - secure storage of tokens (expo-secure-store)
 *  - Google/Apple federation declared but not wired until Cognito federation is
 *    configured (throws clearly; never returns a fabricated session)
 *
 * Config is external (COGNITO from config.ts); no hardcoded ids/secrets/domains.
 * `isProduction = true`. Fails closed on any missing/invalid auth.
 */
import {
  AuthConfigError,
  type AuthProvider,
  type AuthSession,
} from "./AuthProvider";
import { COGNITO } from "../config";
import {
  CognitoError,
  confirmSignUp as apiConfirmSignUp,
  decodeJwtClaims,
  globalSignOut as apiGlobalSignOut,
  initiatePasswordAuth,
  refreshTokens,
  signUp as apiSignUp,
  type CognitoTokens,
} from "./cognitoApi";
import { clearSession, loadSession, saveSession, type StoredSession } from "./tokenStore";

const REFRESH_SKEW_MS = 60_000; // refresh 1 min before expiry

export class CognitoAuthProvider implements AuthProvider {
  readonly isProduction = true;
  private accessToken: string | null = null;

  constructor() {
    if (!COGNITO.region || !COGNITO.userPoolClientId) {
      throw new AuthConfigError(
        "Cognito is not configured. Set EXPO_PUBLIC_COGNITO_REGION and " +
          "EXPO_PUBLIC_COGNITO_APP_CLIENT_ID (and USER_POOL_ID)."
      );
    }
  }

  private toSession(tokens: CognitoTokens, prevRefresh?: string): { session: AuthSession; stored: StoredSession } {
    const claims = decodeJwtClaims(tokens.idToken);
    const sub = claims.sub ?? "";
    const expiresAt = Date.now() + tokens.expiresIn * 1000;
    const stored: StoredSession = {
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? prevRefresh,
      expiresAt,
      sub,
      email: claims.email,
    };
    const session: AuthSession = {
      identity: { sub, email: claims.email },
      idToken: tokens.idToken,
      expiresAt,
    };
    return { session, stored };
  }

  async signUp(email: string, password: string): Promise<void> {
    await apiSignUp(COGNITO.region, COGNITO.userPoolClientId, email, password);
  }

  async confirmSignUp(email: string, code: string): Promise<void> {
    await apiConfirmSignUp(COGNITO.region, COGNITO.userPoolClientId, email, code);
  }

  async signIn(email: string, password: string): Promise<AuthSession> {
    const tokens = await initiatePasswordAuth(COGNITO.region, COGNITO.userPoolClientId, email, password);
    const { session, stored } = this.toSession(tokens);
    this.accessToken = tokens.accessToken ?? null;
    await saveSession(stored);
    return session;
  }

  async signOut(): Promise<void> {
    // Best-effort global sign-out (revokes refresh tokens across devices).
    try {
      if (this.accessToken) await apiGlobalSignOut(COGNITO.region, this.accessToken);
    } catch {
      /* ignore network/expired errors on sign-out */
    }
    this.accessToken = null;
    await clearSession();
  }

  async restoreSession(): Promise<AuthSession | null> {
    const stored = await loadSession();
    if (!stored) return null;
    this.accessToken = stored.accessToken ?? null;
    if (Date.now() < stored.expiresAt - REFRESH_SKEW_MS) {
      return { identity: { sub: stored.sub, email: stored.email }, idToken: stored.idToken, expiresAt: stored.expiresAt };
    }
    // Expired/near-expiry -> try refresh; if it fails, no session (fail closed).
    return this.tryRefresh(stored);
  }

  async getIdToken(): Promise<string | null> {
    const stored = await loadSession();
    if (!stored) return null;
    if (Date.now() < stored.expiresAt - REFRESH_SKEW_MS) return stored.idToken;
    const refreshed = await this.tryRefresh(stored);
    return refreshed?.idToken ?? null;
  }

  private async tryRefresh(stored: StoredSession): Promise<AuthSession | null> {
    if (!stored.refreshToken) {
      await clearSession();
      return null;
    }
    try {
      const tokens = await refreshTokens(COGNITO.region, COGNITO.userPoolClientId, stored.refreshToken);
      const { session, stored: next } = this.toSession(tokens, stored.refreshToken);
      this.accessToken = tokens.accessToken ?? this.accessToken;
      await saveSession(next);
      return session;
    } catch (e) {
      // Refresh failed (revoked/expired) -> clear and require sign-in.
      if (e instanceof CognitoError) await clearSession();
      else await clearSession();
      return null;
    }
  }

  // --- Federation: declared, not wired until Cognito federation is configured.
  async signInWithGoogle(): Promise<AuthSession> {
    throw new Error(
      "Google sign-in is not wired yet (federation slice). It must never return a fabricated session."
    );
  }
  async signInWithApple(): Promise<AuthSession> {
    throw new Error(
      "Apple sign-in is not wired yet (federation slice). It must never return a fabricated session."
    );
  }
}
