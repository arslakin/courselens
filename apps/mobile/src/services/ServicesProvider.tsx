import React, { createContext, useContext, useMemo } from "react";
import { createMockServices, LocalAnalysisBackend } from "@rojanda/core";
import type { AnalysisBackend, Services } from "@rojanda/api";
import { asyncStore } from "./store";
import { ANALYSIS_BASE_URL, API_BASE_URL, isCognitoConfigured } from "../config";
import { RemoteAnalysisBackend } from "./RemoteAnalysisBackend";
import { ExpoRecordingService } from "./ExpoRecordingService";
import { makeTranscription } from "./makeTranscription";
import { makeAuthProvider } from "../auth/makeAuthProvider";
import { createApiClient } from "./apiClient";
import { ApiCourseService, ApiLessonService, ApiProfileService } from "./ApiServices";

/**
 * Provides the app's Services to all screens via context.
 *
 * Persistence: when the RojAnda API is configured (API_BASE_URL + Cognito),
 * profile/course/lesson are API-backed (authoritative, per-`sub`) and
 * transcription uses the authenticated remote backend. Otherwise (development)
 * the local in-memory services are used. Production must NOT silently fall back
 * to local persistence — see `usesApiPersistence` below and the AuthProvider
 * guard (mock auth is refused in release builds).
 */
interface ServicesBundle {
  services: Services;
  backend: AnalysisBackend;
  usesApiPersistence: boolean;
}
const ServicesContext = createContext<ServicesBundle | null>(null);

function makeBackend(): AnalysisBackend {
  return ANALYSIS_BASE_URL ? new RemoteAnalysisBackend(ANALYSIS_BASE_URL) : new LocalAnalysisBackend();
}

export function ServicesProvider({ children }: { children: React.ReactNode }) {
  const bundle = useMemo<ServicesBundle>(() => {
    const backend = makeBackend();
    const auth = makeAuthProvider();
    const getIdToken = () => auth.getIdToken();

    // Base services (local implementations of everything: quiz/flashcards/notes/
    // progress/etc. remain local for Phase 1C). Recording is the real device
    // recorder; transcription is the authenticated remote service when config'd.
    const services = createMockServices(asyncStore, backend, {
      recording: new ExpoRecordingService(),
      transcription: makeTranscription(getIdToken),
    });

    // When the API is configured, override the Phase-1C-persisted entities
    // (profile/course/lesson) with authenticated API-backed repositories.
    const apiConfigured = API_BASE_URL !== "" && isCognitoConfigured;
    if (apiConfigured) {
      const api = createApiClient(API_BASE_URL, getIdToken);
      const courses = new ApiCourseService(api);
      services.profile = new ApiProfileService(api);
      services.courses = courses;
      services.lessons = new ApiLessonService(api, courses);
    }

    return { services, backend, usesApiPersistence: apiConfigured };
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

export function useUsesApiPersistence(): boolean {
  const ctx = useContext(ServicesContext);
  if (!ctx) throw new Error("useUsesApiPersistence must be used within ServicesProvider");
  return ctx.usesApiPersistence;
}
