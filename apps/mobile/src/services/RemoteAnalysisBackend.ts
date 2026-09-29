import type {
  AnalysisBackend,
  AnalyzeOptions,
  AskContext,
  AskResult,
  ExtractResult,
  SourceInputKind,
} from "@rojanda/api";
import type { StudySet } from "@rojanda/types";

/**
 * RemoteAnalysisBackend — calls the RojAnda backend over HTTPS for the AI
 * steps. Enabled by setting ANALYSIS_BASE_URL in config once the backend is
 * deployed. Sends no AWS credentials; a per-user auth token (Cognito JWT) would
 * be attached here, and the backend derives the userId from the token so user
 * isolation is enforced server-side.
 *
 * Implemented against the endpoint contract in
 * rojanda/REAL_DATA_ARCHITECTURE.md. Not active until a base URL is configured.
 */
export class RemoteAnalysisBackend implements AnalysisBackend {
  constructor(private baseUrl: string, private getToken?: () => Promise<string | null>) {}

  private async post<T>(path: string, body: unknown): Promise<T> {
    const token = this.getToken ? await this.getToken() : null;
    const res = await fetch(this.baseUrl.replace(/\/$/, "") + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || `İstek başarısız (${res.status})`;
      throw new Error(msg);
    }
    return data as T;
  }

  async extract(kind: SourceInputKind, input: { uri?: string; text?: string }): Promise<ExtractResult> {
    return this.post<ExtractResult>("/extract", { kind, ...input });
  }
  async analyze(text: string, opts: AnalyzeOptions): Promise<StudySet> {
    return this.post<StudySet>("/analyze", { text, ...opts });
  }
  async ask(ctx: AskContext, question: string, mode: "sources" | "external"): Promise<AskResult> {
    return this.post<AskResult>("/ask", { context: ctx, question, mode });
  }
  async podcastScript(study: StudySet, language: "tr" | "en"): Promise<string> {
    const r = await this.post<{ script: string }>("/podcast", { study, language });
    return r.script;
  }
}
