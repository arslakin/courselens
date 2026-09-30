/**
 * AuthGate — routes between the auth screen and the app based on session state.
 *  - restoring -> loading spinner (session restore in progress)
 *  - signedOut -> AuthScreen (create account / sign in)
 *  - signedIn  -> the app (children)
 * There is no fabricated student: the app renders only for a real session
 * (or a dev mock session when AUTH_MODE=mock in a dev build).
 */
import React from "react";
import { useApp } from "../app-context";
import { Loading, Screen } from "../ui";
import { AuthScreen } from "./AuthScreen";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { authStatus, t } = useApp();

  if (authStatus === "restoring") {
    return (
      <Screen scroll={false} contentStyle={{ flex: 1, justifyContent: "center" }}>
        <Loading label={t.auth.restoring} />
      </Screen>
    );
  }
  if (authStatus === "signedOut") {
    return <AuthScreen />;
  }
  return <>{children}</>;
}
