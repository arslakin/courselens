/**
 * Guarded auth-provider factory.
 *
 * Enforces the hard rule: production behavior must NOT silently fall back to a
 * fake authenticated student.
 *  - AUTH_MODE="cognito"  -> CognitoAuthProvider (throws if unconfigured; never
 *    falls back to the mock).
 *  - AUTH_MODE="mock"     -> MockAuthProvider, allowed ONLY in __DEV__. In a
 *    production (release) build, selecting mock is refused.
 */
import { AUTH_MODE } from "../config";
import type { AuthProvider } from "./AuthProvider";
import { CognitoAuthProvider } from "./CognitoAuthProvider";
import { MockAuthProvider } from "./MockAuthProvider";

let _instance: AuthProvider | null = null;

function build(): AuthProvider {
  if (AUTH_MODE === "cognito") {
    // Production path. CognitoAuthProvider throws AuthConfigError if the pool
    // isn't configured — we do NOT fall back to the mock.
    return new CognitoAuthProvider();
  }

  // AUTH_MODE === "mock": development only.
  // __DEV__ is a global injected by the RN/Expo bundler (false in release).
  const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : false;
  if (!isDev) {
    throw new Error(
      "Refusing to use MockAuthProvider in a production build. Set " +
        "EXPO_PUBLIC_AUTH_MODE=cognito and configure the Cognito User Pool."
    );
  }
  return new MockAuthProvider();
}

/** Single shared AuthProvider instance (ServicesProvider + AppProvider share it
 *  so the session/getIdToken is consistent across the app). */
export function makeAuthProvider(): AuthProvider {
  if (!_instance) _instance = build();
  return _instance;
}
