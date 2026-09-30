import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@rojanda/types";
import { getStrings, DEFAULT_LOCALE, type Locale, type Strings } from "@rojanda/i18n";
import { useServices } from "./services/ServicesProvider";
import { makeAuthProvider } from "./auth/makeAuthProvider";
import type { AuthProvider, AuthSession } from "./auth/AuthProvider";

type AuthStatus = "restoring" | "signedOut" | "signedIn";

interface AppContextValue {
  user: User | null;
  loading: boolean;
  locale: Locale;
  t: Strings;
  /** Auth session state for routing between auth screens and the app. */
  authStatus: AuthStatus;
  /** The verified auth identity (sub) once signed in; display/routing only. */
  session: AuthSession | null;
  /** The auth provider (sign in/up/out live here). */
  auth: AuthProvider;
  /** Called after a successful sign-in to hydrate the app session. */
  onSignedIn: (session: AuthSession) => Promise<void>;
  signOut: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * App session context (Phase 1B).
 *
 * Authentication/session state flows through the AuthProvider architecture —
 * there is NO unconditional production auto-login and NO fabricated student.
 *  - launch -> restore session -> (signedIn) hydrate app, or (signedOut) show
 *    the authentication screen.
 * In development (AUTH_MODE=mock) the MockAuthProvider may restore/create a
 * local dev session; release builds cannot use it (see makeAuthProvider).
 *
 * The authoritative ownerId is the verified Cognito `sub` (server-derived).
 * Here we only use the `sub` to scope the LOCAL domain user record; ownership
 * is enforced by the backend, never asserted by the client.
 */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const services = useServices();
  const auth = useMemo(() => makeAuthProvider(), []);

  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("restoring");
  const locale: Locale = DEFAULT_LOCALE;

  // Hydrate the local domain user for a verified session. The local user id is
  // the verified `sub` (authoritative identity); profile fields are editable.
  const hydrate = async (s: AuthSession): Promise<void> => {
    const existing = await services.auth.getCurrentUser();
    let user =
      existing && existing.id === s.identity.sub
        ? existing
        : await services.auth.signIn(s.identity.email ?? "ogrenci@rojanda.app", "Öğrenci");
    // The local domain user's id is the VERIFIED sub (authoritative identity),
    // so any local-service scoping matches the authenticated owner. Ownership
    // is still enforced by the backend from the JWT; this only aligns local
    // records with the signed-in identity.
    if (user.id !== s.identity.sub) user = { ...user, id: s.identity.sub, email: s.identity.email ?? user.email };
    setUser(user);
    setSession(s);
    setAuthStatus("signedIn");
  };

  const onSignedIn = async (s: AuthSession): Promise<void> => {
    await hydrate(s);
  };

  const signOut = async (): Promise<void> => {
    await auth.signOut();
    await services.auth.signOut();
    setUser(null);
    setSession(null);
    setAuthStatus("signedOut");
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const restored = await auth.restoreSession();
      if (!active) return;
      if (restored) {
        await hydrate(restored);
      } else {
        setAuthStatus("signedOut");
      }
    })();
    return () => {
      active = false;
    };
  }, [auth]);

  const loading = authStatus === "restoring";

  return (
    <AppContext.Provider
      value={{ user, loading, locale, t: getStrings(locale), authStatus, session, auth, onSignedIn, signOut }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
