/**
 * RojAnda client authentication abstraction (Phase 1A).
 *
 * Separates AUTHENTICATION (identity + session + JWT) from the student PROFILE.
 * The authoritative ownership identifier is the Cognito User Pool `sub`, which
 * the BACKEND derives from the verified JWT — the client never asserts its own
 * ownerId. On the client, `sub` is available only for display/routing; it is
 * never sent as a proof of ownership (only the Bearer JWT is).
 *
 * Two implementations:
 *  - CognitoAuthProvider: production (Cognito User Pool; email/password now,
 *    Google/Apple via federation later). Reads config from the environment;
 *    no hardcoded pool ids/secrets/domains.
 *  - MockAuthProvider: development ONLY. It is guarded so it can never be used
 *    as production auth (see makeAuthProvider).
 */

/** Minimal identity extracted from the ID token. `sub` is display/routing only
 *  on the client; ownership is enforced server-side from the verified JWT. */
export interface AuthIdentity {
  /** Cognito User Pool sub (immutable). Informational on the client. */
  sub: string;
  /** Informational only; NEVER an ownership/authorization identifier. */
  email?: string;
}

export interface AuthSession {
  identity: AuthIdentity;
  /** The JWT sent as `Authorization: Bearer <idToken>` to the RojAnda API. */
  idToken: string;
  /** Epoch ms when idToken expires (used to trigger refresh). */
  expiresAt: number;
}

export interface AuthProvider {
  /** Whether this provider is safe to use as production auth. */
  readonly isProduction: boolean;

  /** Create a new account (email/password). */
  signUp(email: string, password: string): Promise<void>;
  /** Confirm sign-up with the emailed code (Cognito). No-op where not needed. */
  confirmSignUp(email: string, code: string): Promise<void>;
  /** Sign in; resolves the active session. */
  signIn(email: string, password: string): Promise<AuthSession>;
  /** Clear the local session (and revoke refresh where supported). */
  signOut(): Promise<void>;
  /** Restore a persisted session on app start, or null if none/expired. */
  restoreSession(): Promise<AuthSession | null>;
  /** Return a currently-valid JWT (refreshing if needed), or null if signed out. */
  getIdToken(): Promise<string | null>;

  // Federation hooks (implemented in a later slice; declared for shape):
  /** Begin Google sign-in (Phase: later). */
  signInWithGoogle?(): Promise<AuthSession>;
  /** Begin Apple sign-in (iOS production readiness; later). */
  signInWithApple?(): Promise<AuthSession>;
}

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

export class NotAuthenticatedError extends Error {
  constructor() {
    super("not-authenticated");
    this.name = "NotAuthenticatedError";
  }
}
