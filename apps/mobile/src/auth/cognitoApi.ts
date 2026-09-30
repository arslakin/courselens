/**
 * Minimal Cognito User Pool client over the public JSON API (Phase 1B).
 *
 * The Cognito Identity Provider service is a plain JSON-over-HTTPS API
 * (`X-Amz-Target` header + JSON body). Using `USER_PASSWORD_AUTH` means NO SRP,
 * so we need no AWS SDK, no crypto/stream polyfills, and no native module —
 * which keeps the app fully Expo Go + web compatible and the bundle tiny.
 * (AWS SDK v3 and Amplify were rejected for Expo Go polyfill/native weight; see
 * rojanda/PRODUCTION_PHASE1_PLAN.md auth-SDK decision.)
 *
 * NOTE: `USER_PASSWORD_AUTH` must be enabled on the app client (ALLOW_USER_
 * PASSWORD_AUTH) when the User Pool is created out-of-band. No secrets are used
 * (public app client, no client secret in a mobile app).
 */

export interface CognitoTokens {
  idToken: string;
  accessToken: string;
  refreshToken?: string;
  /** seconds */
  expiresIn: number;
}

function endpoint(region: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/`;
}

async function call<T>(region: string, target: string, body: unknown): Promise<T> {
  const res = await fetch(endpoint(region), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Cognito returns { __type, message }. Surface a typed error, never a token.
    const type = (data && (data.__type || data.code)) || "CognitoError";
    const message = (data && data.message) || `Cognito request failed (${res.status})`;
    throw new CognitoError(String(type), String(message));
  }
  return data as T;
}

export class CognitoError extends Error {
  constructor(public readonly type: string, message: string) {
    super(message);
    this.name = "CognitoError";
  }
}

export async function signUp(
  region: string,
  clientId: string,
  email: string,
  password: string
): Promise<void> {
  await call(region, "SignUp", {
    ClientId: clientId,
    Username: email,
    Password: password,
    UserAttributes: [{ Name: "email", Value: email }],
  });
}

export async function confirmSignUp(
  region: string,
  clientId: string,
  email: string,
  code: string
): Promise<void> {
  await call(region, "ConfirmSignUp", {
    ClientId: clientId,
    Username: email,
    ConfirmationCode: code,
  });
}

export async function initiatePasswordAuth(
  region: string,
  clientId: string,
  email: string,
  password: string
): Promise<CognitoTokens> {
  const resp = await call<{ AuthenticationResult?: any }>(region, "InitiateAuth", {
    ClientId: clientId,
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });
  const r = resp.AuthenticationResult;
  if (!r || !r.IdToken) throw new CognitoError("NoTokens", "Kimlik doğrulama tamamlanamadı.");
  return {
    idToken: r.IdToken,
    accessToken: r.AccessToken,
    refreshToken: r.RefreshToken,
    expiresIn: r.ExpiresIn ?? 3600,
  };
}

export async function refreshTokens(
  region: string,
  clientId: string,
  refreshToken: string
): Promise<CognitoTokens> {
  const resp = await call<{ AuthenticationResult?: any }>(region, "InitiateAuth", {
    ClientId: clientId,
    AuthFlow: "REFRESH_TOKEN_AUTH",
    AuthParameters: { REFRESH_TOKEN: refreshToken },
  });
  const r = resp.AuthenticationResult;
  if (!r || !r.IdToken) throw new CognitoError("NoTokens", "Oturum yenilenemedi.");
  return {
    idToken: r.IdToken,
    accessToken: r.AccessToken,
    // Refresh flow does not return a new refresh token; caller keeps the old one.
    refreshToken: r.RefreshToken,
    expiresIn: r.ExpiresIn ?? 3600,
  };
}

export async function globalSignOut(region: string, accessToken: string): Promise<void> {
  await call(region, "GlobalSignOut", { AccessToken: accessToken });
}

/**
 * Decode (NOT verify) a JWT payload to read `sub`/`email` for display/routing.
 * The client never trusts these for authorization — the BACKEND verifies the
 * signature and derives ownerId from the verified `sub`.
 */
export function decodeJwtClaims(idToken: string): { sub?: string; email?: string; exp?: number } {
  const parts = idToken.split(".");
  if (parts.length !== 3) return {};
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeBase64(payload);
    const claims = JSON.parse(json);
    return { sub: claims.sub, email: claims.email, exp: claims.exp };
  } catch {
    return {};
  }
}

/** Base64 decode that works in RN (no atob) and web. */
function decodeBase64(b64: string): string {
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const input = b64 + pad;
  if (typeof atob === "function") return decodeURIComponent(escape(atob(input)));
  // RN fallback via Buffer if present.
  const g: any = globalThis as any;
  if (g.Buffer) return g.Buffer.from(input, "base64").toString("utf-8");
  // Last-resort manual decode.
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const ch of input) {
    if (ch === "=") break;
    const idx = chars.indexOf(ch);
    if (idx < 0) continue;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return decodeURIComponent(escape(out));
}
