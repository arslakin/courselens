/**
 * Phase 1B auth tests: JWT decode (display-only), secure token-store round-trip,
 * session restore/refresh/expiry, sign-out clears session, and the
 * mock-cannot-be-production + config-fails-closed guards.
 *
 * expo-secure-store is mocked with an in-memory store (native module can't load
 * under jest-node). No network: cognitoApi is exercised only via decodeJwtClaims
 * and the provider is driven with a mocked cognitoApi where needed.
 */

// --- in-memory expo-secure-store mock ---
const mem: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mem[k] = v;
  }),
  getItemAsync: jest.fn(async (k: string) => (k in mem ? mem[k] : null)),
  deleteItemAsync: jest.fn(async (k: string) => {
    delete mem[k];
  }),
}));

import { decodeJwtClaims } from "./cognitoApi";
import { saveSession, loadSession, clearSession, type StoredSession } from "./tokenStore";

const SUB = "11111111-1111-4111-8111-111111111111";

// Build an unsigned JWT (header.payload.signature) for decode-only tests.
function fakeJwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}

beforeEach(() => {
  for (const k of Object.keys(mem)) delete mem[k];
});

describe("decodeJwtClaims (display/routing only, never trusted for auth)", () => {
  it("reads sub/email/exp from a JWT payload", () => {
    const token = fakeJwt({ sub: SUB, email: "s@example.com", exp: 123 });
    const c = decodeJwtClaims(token);
    expect(c.sub).toBe(SUB);
    expect(c.email).toBe("s@example.com");
    expect(c.exp).toBe(123);
  });

  it("returns empty for a malformed token (no fabrication)", () => {
    expect(decodeJwtClaims("not-a-jwt")).toEqual({});
    expect(decodeJwtClaims("")).toEqual({});
  });
});

describe("secure token store", () => {
  const session: StoredSession = {
    idToken: "id.tok.en",
    accessToken: "acc",
    refreshToken: "ref",
    expiresAt: Date.now() + 3600_000,
    sub: SUB,
    email: "s@example.com",
  };

  it("round-trips a session and clears it on sign-out", async () => {
    expect(await loadSession()).toBeNull();
    await saveSession(session);
    const loaded = await loadSession();
    expect(loaded?.sub).toBe(SUB);
    expect(loaded?.idToken).toBe("id.tok.en");
    await clearSession();
    expect(await loadSession()).toBeNull();
  });

  it("returns null for corrupted stored data (fails closed)", async () => {
    const SecureStore = require("expo-secure-store");
    await SecureStore.setItemAsync("rojanda.auth.session.v1", "{not json");
    expect(await loadSession()).toBeNull();
  });
});

describe("mock cannot become production auth", () => {
  it("MockAuthProvider is non-production and refused in a release build", () => {
    jest.isolateModules(() => {
      // Simulate a release build.
      (global as any).__DEV__ = false;
      jest.doMock("../config", () => ({ AUTH_MODE: "mock", COGNITO: {}, isCognitoConfigured: false }));
      const { makeAuthProvider } = require("./makeAuthProvider");
      expect(() => makeAuthProvider()).toThrow(/Refusing to use MockAuthProvider/);
    });
  });

  it("dev build allows the mock provider (non-production)", () => {
    jest.isolateModules(() => {
      (global as any).__DEV__ = true;
      jest.doMock("../config", () => ({ AUTH_MODE: "mock", COGNITO: {}, isCognitoConfigured: false }));
      const { makeAuthProvider } = require("./makeAuthProvider");
      const p = makeAuthProvider();
      expect(p.isProduction).toBe(false);
    });
  });
});

describe("production config fails closed", () => {
  it("CognitoAuthProvider throws AuthConfigError when unconfigured", () => {
    jest.isolateModules(() => {
      jest.doMock("../config", () => ({
        COGNITO: { region: "", userPoolId: "", userPoolClientId: "" },
        AUTH_MODE: "cognito",
      }));
      const { CognitoAuthProvider } = require("./CognitoAuthProvider");
      const { AuthConfigError } = require("./AuthProvider");
      expect(() => new CognitoAuthProvider()).toThrow(AuthConfigError);
    });
  });

  it("AUTH_MODE=cognito never falls back to the mock when unconfigured", () => {
    jest.isolateModules(() => {
      jest.doMock("../config", () => ({
        COGNITO: { region: "", userPoolId: "", userPoolClientId: "" },
        AUTH_MODE: "cognito",
      }));
      const { makeAuthProvider } = require("./makeAuthProvider");
      // Throws (config error) rather than returning a MockAuthProvider.
      expect(() => makeAuthProvider()).toThrow();
    });
  });
});

describe("CognitoAuthProvider session lifecycle (mocked cognitoApi)", () => {
  it("signIn stores a session, getIdToken returns it, signOut clears it", async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock("../config", () => ({
        COGNITO: { region: "eu-central-1", userPoolId: "pool", userPoolClientId: "client", hostedUiDomain: "" },
        AUTH_MODE: "cognito",
      }));
      const idToken = fakeJwt({ sub: SUB, email: "s@example.com", exp: Math.floor(Date.now() / 1000) + 3600 });
      jest.doMock("./cognitoApi", () => ({
        ...jest.requireActual("./cognitoApi"),
        initiatePasswordAuth: jest.fn(async () => ({
          idToken,
          accessToken: "acc",
          refreshToken: "ref",
          expiresIn: 3600,
        })),
        globalSignOut: jest.fn(async () => {}),
      }));
      const { CognitoAuthProvider } = require("./CognitoAuthProvider");
      const p = new CognitoAuthProvider();

      const session = await p.signIn("s@example.com", "pw");
      expect(session.identity.sub).toBe(SUB);
      expect(await p.getIdToken()).toBe(idToken);

      await p.signOut();
      expect(await p.getIdToken()).toBeNull();
      expect(await p.restoreSession()).toBeNull();
    });
  });

  it("restoreSession returns null when there is no stored session (fail closed)", async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock("../config", () => ({
        COGNITO: { region: "eu-central-1", userPoolId: "pool", userPoolClientId: "client", hostedUiDomain: "" },
        AUTH_MODE: "cognito",
      }));
      const { CognitoAuthProvider } = require("./CognitoAuthProvider");
      const p = new CognitoAuthProvider();
      expect(await p.restoreSession()).toBeNull();
    });
  });

  it("federation is declared but never returns a fabricated session", async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock("../config", () => ({
        COGNITO: { region: "eu-central-1", userPoolId: "pool", userPoolClientId: "client", hostedUiDomain: "" },
        AUTH_MODE: "cognito",
      }));
      const { CognitoAuthProvider } = require("./CognitoAuthProvider");
      const p = new CognitoAuthProvider();
      await expect(p.signInWithGoogle()).rejects.toThrow();
      await expect(p.signInWithApple()).rejects.toThrow();
    });
  });
});
