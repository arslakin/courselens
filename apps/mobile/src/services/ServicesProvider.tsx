import React, { createContext, useContext, useMemo } from "react";
import { createMockServices } from "@rojanda/core";
import type { Services } from "@rojanda/api";
import { asyncStore } from "./store";

/**
 * Provides the app's Services to all screens via context.
 *
 * Today it wires the LOCAL MOCK services over AsyncStorage. To move to AWS
 * later, swap `createMockServices(asyncStore)` for the real service set here —
 * no screen changes required, because screens depend only on the Services
 * interface.
 */
const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ children }: { children: React.ReactNode }) {
  const services = useMemo(() => createMockServices(asyncStore), []);
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error("useServices must be used within ServicesProvider");
  return ctx;
}
