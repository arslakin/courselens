/**
 * Authenticated JSON API client for the RojAnda backend (Phase 1C).
 *
 * Attaches `Authorization: Bearer <idToken>` from the AuthProvider. No AWS
 * credentials, no SigV4, no Identity Pool — the backend derives the owner from
 * the verified JWT `sub`. Fails closed when there is no valid session.
 */
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export class NotAuthenticatedError extends ApiError {
  constructor() {
    super(401, "unauthorized", "Oturum bulunamadı.");
  }
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

export function createApiClient(baseUrl: string, getIdToken: () => Promise<string | null>): ApiClient {
  const base = baseUrl.replace(/\/$/, "");

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getIdToken();
    if (!token) throw new NotAuthenticatedError(); // fail closed; never anonymous

    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const code = (data && data.error && data.error.code) || "error";
      const message = (data && data.error && data.error.message) || `İstek başarısız (${res.status})`;
      throw new ApiError(res.status, code, message);
    }
    return data as T;
  }

  return {
    get: (p) => request("GET", p),
    post: (p, b) => request("POST", p, b),
    put: (p, b) => request("PUT", p, b),
    del: (p) => request("DELETE", p),
  };
}
