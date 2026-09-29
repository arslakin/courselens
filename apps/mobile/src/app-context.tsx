import React, { createContext, useContext, useEffect, useState } from "react";
import type { User } from "@rojanda/types";
import { getStrings, DEFAULT_LOCALE, type Locale, type Strings } from "@rojanda/i18n";
import { useServices } from "./services/ServicesProvider";

interface AppContextValue {
  user: User | null;
  loading: boolean;
  locale: Locale;
  t: Strings;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * App session context. For this phase it auto-signs-in a local mock user so the
 * flow is demoable without an auth screen; the AuthService interface stays in
 * place for a real Cognito sign-in later.
 */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const services = useServices();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const locale: Locale = DEFAULT_LOCALE;

  useEffect(() => {
    let active = true;
    (async () => {
      let current = await services.auth.getCurrentUser();
      if (!current) current = await services.auth.signIn("ogrenci@rojanda.app", "Öğrenci");
      if (active) {
        setUser(current);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [services]);

  return (
    <AppContext.Provider value={{ user, loading, locale, t: getStrings(locale) }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
