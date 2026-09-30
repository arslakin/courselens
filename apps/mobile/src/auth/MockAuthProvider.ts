/**
 * MockAuthProvider — DEVELOPMENT ONLY.
 *
 * Simulates a signed-in student locally so the app is usable without a real
 * Cognito User Pool during development. It is `isProduction = false` and the
 * factory (makeAuthProvider) refuses to use it when AUTH_MODE is "cognito", so
 * it can never silently become production auth.
 *
 * It issues a clearly-fake local token that is NOT a real JWT. Any real backend
 * with a JWT authorizer will reject it — by design, so a dev build cannot
 * accidentally authenticate against production.
 */
import type { AuthProvider, AuthSession } from "./AuthProvider";

const DEV_SUB = "00000000-0000-4000-8000-000000000000"; // fixed dev UUID (sub shape)
const ONE_HOUR = 60 * 60 * 1000;

export class MockAuthProvider implements AuthProvider {
  readonly isProduction = false;
  private session: AuthSession | null = null;

  private make(email: string): AuthSession {
    return {
      identity: { sub: DEV_SUB, email },
      // Explicitly-fake token; not a JWT. Real authorizers reject it.
      idToken: "dev-mock-token.not-a-real-jwt",
      expiresAt: Date.now() + ONE_HOUR,
    };
  }

  async signUp(_email: string, _password: string): Promise<void> {
    /* no-op in dev */
  }
  async confirmSignUp(_email: string, _code: string): Promise<void> {
    /* no-op in dev */
  }
  async signIn(email: string, _password: string): Promise<AuthSession> {
    this.session = this.make(email || "ogrenci@rojanda.app");
    return this.session;
  }
  async signOut(): Promise<void> {
    this.session = null;
  }
  async restoreSession(): Promise<AuthSession | null> {
    return this.session;
  }
  async getIdToken(): Promise<string | null> {
    return this.session?.idToken ?? null;
  }
}
