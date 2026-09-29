import React, { createContext, useContext, useMemo } from "react";
import { createMockServices, LocalAnalysisBackend } from "@rojanda/core";
import type { AnalysisBackend, Services } from "@rojanda/api";
import { asyncStore } from "./store";
import { ANALYSIS_BASE_URL } from "../config";
import { RemoteAnalysisBackend } from "./RemoteAnalysisBackend";
import { ExpoRecordingService } from "./ExpoRecordingService";

/**
 * Provides the app's Services to all screens via context.
 *
 * The AI steps run behind the AnalysisBackend interface. By default we use the
 * LOCAL, offline, grounded implementation so the full flow works today with no
 * AWS. When the RojAnda backend is deployed, set ANALYSIS_BASE_URL in config
 * and this automatically uses the RemoteAnalysisBackend — no screen changes.
 */
interface ServicesBundle {
  services: Services;
  backend: AnalysisBackend;
}
const ServicesContext = createContext<ServicesBundle | null>(null);

function makeBackend(): AnalysisBackend {
  return ANALYSIS_BASE_URL ? new RemoteAnalysisBackend(ANALYSIS_BASE_URL) : new LocalAnalysisBackend();
}

export function ServicesProvider({ children }: { children: React.ReactNode }) {
  const bundle = useMemo<ServicesBundle>(() => {
    const backend = makeBackend();
    // Inject the real device recorder; transcription stays honest/pending
    // (default) until the RojAnda backend is connected.
    const services = createMockServices(asyncStore, backend, {
      recording: new ExpoRecordingService(),
    });
    return { services, backend };
  }, []);
  return <ServicesContext.Provider value={bundle}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error("useServices must be used within ServicesProvider");
  return ctx.services;
}

export function useBackend(): AnalysisBackend {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error("useBackend must be used within ServicesProvider");
  return ctx.backend;
}
