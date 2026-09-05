import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { PlatformAssertionClaims } from "@workspace/platform-contract";
import {
  Router,
  type CookieOptions,
  type Request,
  type Response,
} from "express";

import {
  PlatformAuthUnavailableError,
  type PlatformAuthClient,
} from "../lib/platform-auth-client.js";
import {
  AUTH_COOKIE_NAMES,
  hasFamilyCookie,
  familyCookies,
  clearFamilyCookies,
  clearLegacyCookies,
  sendRenewalError,
} from "../lib/tf-browser-session.js";
import type { TfRenewalConsumer } from "../lib/tf-renewal-consumer.js";
import {
  TfRenewalError,
  unavailable,
  renewalVersion,
  opaqueSchema,
} from "../lib/tf-renewal-contract.js";
import type { FamilyObservation } from "../lib/tf-family-store.js";
import {
  TfSessionStoreUnavailableError,
  type TfSessionStore,
} from "../lib/tf-session-store.js";

const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[\x21-\x7e]{32,512}$/;
const INSTALLATION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1_000;
const TRANSACTION_MAX_AGE_MS = 5 * 60 * 1_000;
const INSTALLATION_LABEL = "Apollo TF Web";

export { AUTH_COOKIE_NAMES } from "../lib/tf-browser-session.js";

export interface AuthRouteDependencies {
  readonly platform: Pick<
    PlatformAuthClient,
    "createAuthorizationUrl" | "exchangeCode" | "introspect"
  >;
  readonly sessionStore: Pick<
    TfSessionStore,
    | "createTransaction"
    | "consumeTransaction"
    | "createSession"
    | "getSession"
    | "observeSession"
    | "refreshSession"
    | "revokeSession"
    | "issueProviderOAuthState"
    | "consumeProviderOAuthState"
    | "issueWebSocketTicket"
  >;
  readonly webOrigin: string;
  readonly secureCookies: boolean;
  readonly pkceVerifier?: () => string;
  readonly renewal?: TfRenewalConsumer;
}

class AuthRequestError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 503) {
    super("authentication failed");
  }
}

function opaqueValue(): string {
  return randomBytes(32).toString("base64url");
}

function baseCookieOptions(secure: boolean, httpOnly: boolean): CookieOptions {
  return {
    secure,
    httpOnly,
    sameSite: "lax",
    path: "/",
  };
}

function setHostCookie(
  response: Response,
  name: string,
  value: string,
  options: CookieOptions,
): void {
  response.cookie(name, value, options);
}

function clearHostCookie(
  response: Response,
  name: string,
  options: CookieOptions,
): void {
  response.clearCookie(name, options);
}

function cookieValue(request: Request, name: string): string | null {
  const value = (request.cookies as Record<string, unknown> | undefined)?.[
    name
  ];
  return typeof value === "string" ? value : null;
}

function exactQuery(
  request: Request,
  expectedFields: readonly string[],
): Readonly<Record<string, string>> {
  const queryIndex = request.originalUrl.indexOf("?");
  const parameters = new URLSearchParams(
    queryIndex < 0 ? "" : request.originalUrl.slice(queryIndex + 1),
  );
  const expected = new Set(expectedFields);
  const values: Record<string, string> = Object.create(null);
  for (const [name, value] of parameters) {
    if (!expected.has(name) || Object.hasOwn(values, name)) {
      throw new AuthRequestError(400);
    }
    values[name] = value;
  }
  if (Object.keys(values).length !== expectedFields.length) {
    throw new AuthRequestError(400);
  }
  return values;
}

function requireNoQuery(request: Request): void {
  exactQuery(request, []);
}

function fixedOpaqueEqual(left: string, right: string): boolean {
  if (!OPAQUE_PATTERN.test(left) || !OPAQUE_PATTERN.test(right)) {
    return false;
  }
  const leftBytes = Buffer.from(left, "base64url");
  const rightBytes = Buffer.from(right, "base64url");
  return (
    leftBytes.byteLength === 32 &&
    rightBytes.byteLength === 32 &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function requireBoundIntrospection(
  claims: PlatformAssertionClaims,
  introspection: Awaited<
    ReturnType<AuthRouteDependencies["platform"]["introspect"]>
  >,
): asserts introspection is Extract<typeof introspection, { active: true }> {
  if (
    !introspection.active ||
    introspection.accountId !== claims.sub ||
    introspection.sessionId !== claims.sid ||
    introspection.installationId !== claims.installation_id
  ) {
    throw new AuthRequestError(400);
  }
}

function statusFor(error: unknown): 400 | 503 {
  if (
    error instanceof PlatformAuthUnavailableError ||
    error instanceof TfSessionStoreUnavailableError
  ) {
    return 503;
  }
  if (error instanceof AuthRequestError && error.status === 400) {
    return 400;
  }
  return 503;
}

function sendAuthenticationError(
  response: Response,
  status: 400 | 401 | 403 | 503,
): void {
  if (status === 401) {
    response.status(401).json({ error: "unauthorized" });
    return;
  }
  if (status === 403) {
    response.status(403).json({ error: "forbidden" });
    return;
  }
  response.status(status).json({
    error:
      status === 503 ? "authentication_unavailable" : "authentication_failed",
  });
}

export function createAuthRouter(dependencies: AuthRouteDependencies): Router {
  const router = Router();
  const httpOnlyCookie = baseCookieOptions(dependencies.secureCookies, true);
  const csrfCookie = baseCookieOptions(dependencies.secureCookies, false);
  async function retireLegacy(request: Request) {
    const handle = cookieValue(request, AUTH_COOKIE_NAMES.session);
    if (handle && OPAQUE_PATTERN.test(handle))
      await dependencies.sessionStore.revokeSession(handle);
  }
  function setFamily(
    handle: string,
    observation: FamilyObservation,
    response: Response,
  ) {
    const r = observation.record;
    if (r.phase === "CLOSED") throw new TfRenewalError("INVALID_REFERENCE");
    const expires = new Date(r.expiresAt);
    setHostCookie(response, AUTH_COOKIE_NAMES.family, handle, {
      ...httpOnlyCookie,
      secure: true,
      expires,
    });
    setHostCookie(response, AUTH_COOKIE_NAMES.familyCsrf, r.csrf, {
      ...csrfCookie,
      secure: true,
      expires,
    });
  }

  router.use((_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  router.get("/start", async (request, response) => {
    try {
      requireNoQuery(request);
      const existingInstallation = cookieValue(
        request,
        AUTH_COOKIE_NAMES.installation,
      );
      const installationId =
        existingInstallation !== null && UUID_PATTERN.test(existingInstallation)
          ? existingInstallation
          : randomUUID();
      const state = opaqueValue();
      const nonce = opaqueValue();
      const codeVerifier = dependencies.pkceVerifier?.() ?? opaqueValue();
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
        throw new AuthRequestError(503);
      }
      let familyHandle: string | undefined;
      let familyReplacementAuthorized = true;
      if (dependencies.renewal) {
        const suppliedBinder = cookieValue(request, AUTH_COOKIE_NAMES.browser);
        let binder = opaqueSchema.safeParse(suppliedBinder).success
          ? suppliedBinder!
          : opaqueValue();
        let previous: ReturnType<typeof familyCookies> | undefined;
        if (hasFamilyCookie(request)) {
          previous = familyCookies(request);
          const current = await dependencies.renewal.store.read(
            previous.handle,
          );
          if (current && current.record.phase !== "CLOSED") {
            if (
              !(await dependencies.renewal.validateCsrf(
                previous.handle,
                previous.csrf,
                previous.csrf,
              )) ||
              (opaqueSchema.safeParse(suppliedBinder).success &&
                suppliedBinder !== current.record.lineageId)
            )
              throw new AuthRequestError(403);
            binder = current.record.lineageId;
          }
        }
        const active =
          await dependencies.renewal.store.activeForBrowser(binder);
        if (active)
          familyReplacementAuthorized =
            previous?.handle === active.handle &&
            request.get("origin") === dependencies.webOrigin &&
            (await dependencies.renewal.validateCsrf(
              active.handle,
              previous.csrf,
              request.get("x-csrf-token") ?? "",
            ));
        familyHandle = (await dependencies.renewal.createLogin(binder)).handle;
        // Non-authorizing browser custody, independent of the public installation hint.
        setHostCookie(response, AUTH_COOKIE_NAMES.browser, binder, {
          ...httpOnlyCookie,
          secure: true,
          maxAge: INSTALLATION_MAX_AGE_MS,
        });
      } else if (hasFamilyCookie(request)) throw unavailable();
      const transactionHandle =
        await dependencies.sessionStore.createTransaction({
          state,
          nonce,
          codeVerifier,
          installationId,
          installationLabel: INSTALLATION_LABEL,
          ...(familyHandle
            ? { familyHandle, familyReplacementAuthorized }
            : {}),
        });
      const codeChallenge = createHash("sha256")
        .update(codeVerifier, "ascii")
        .digest("base64url");
      const location = dependencies.platform.createAuthorizationUrl({
        codeChallenge,
        state,
        nonce,
        installationId,
        installationLabel: INSTALLATION_LABEL,
      });

      setHostCookie(response, AUTH_COOKIE_NAMES.installation, installationId, {
        ...httpOnlyCookie,
        maxAge: INSTALLATION_MAX_AGE_MS,
      });
      setHostCookie(
        response,
        AUTH_COOKIE_NAMES.transaction,
        transactionHandle,
        {
          ...httpOnlyCookie,
          maxAge: TRANSACTION_MAX_AGE_MS,
        },
      );
      response.redirect(303, location);
    } catch (error) {
      sendAuthenticationError(
        response,
        error instanceof AuthRequestError && error.status === 403
          ? 403
          : statusFor(error),
      );
    }
  });

  router.get("/callback", async (request, response) => {
    let successorHandle: string | undefined;
    try {
      const transactionHandle = cookieValue(
        request,
        AUTH_COOKIE_NAMES.transaction,
      );
      if (
        transactionHandle === null ||
        !OPAQUE_PATTERN.test(transactionHandle)
      ) {
        throw new AuthRequestError(400);
      }
      const transaction =
        await dependencies.sessionStore.consumeTransaction(transactionHandle);
      if (transaction === null) {
        throw new AuthRequestError(400);
      }
      successorHandle = transaction.familyHandle;
      const query = exactQuery(request, ["code", "state"]);
      const code = query.code!;
      const state = query.state!;
      if (
        !CODE_PATTERN.test(code) ||
        !OPAQUE_PATTERN.test(state) ||
        !fixedOpaqueEqual(transaction.state, state)
      ) {
        throw new AuthRequestError(400);
      }
      const exchange = await dependencies.platform.exchangeCode({
        code,
        codeVerifier: transaction.codeVerifier,
        expectedNonce: transaction.nonce,
      });
      if (
        transaction.familyHandle !== undefined ||
        dependencies.renewal !== undefined ||
        hasFamilyCookie(request)
      ) {
        if (!dependencies.renewal || !transaction.familyHandle)
          throw unavailable();
        if (transaction.familyReplacementAuthorized !== true)
          throw new AuthRequestError(403);
        await dependencies.renewal.store.beginEnrollment(
          transaction.familyHandle,
          {
            ...renewalVersion,
            account_id: exchange.claims.sub,
            session_id: exchange.claims.sid,
            installation_id: exchange.claims.installation_id,
            client_id: dependencies.renewal.clientId,
            audience: "apollo-tf",
          },
          exchange.assertion,
        );
        await retireLegacy(request);
        await dependencies.renewal.renew(transaction.familyHandle);
        const current = await dependencies.renewal.store.read(
          transaction.familyHandle,
        );
        if (!current || current.record.phase !== "ACTIVE") throw unavailable();
        setFamily(transaction.familyHandle, current, response);
        clearHostCookie(
          response,
          AUTH_COOKIE_NAMES.transaction,
          httpOnlyCookie,
        );
        clearLegacyCookies(response, dependencies.secureCookies);
        response.redirect(303, dependencies.webOrigin);
        return;
      }
      const introspection = await dependencies.platform.introspect({
        accountId: exchange.claims.sub,
        sessionId: exchange.claims.sid,
        installationId: exchange.claims.installation_id,
        audience: "apollo-tf",
      });
      requireBoundIntrospection(exchange.claims, introspection);
      const created = await dependencies.sessionStore.createSession({
        assertionClaims: exchange.claims,
        introspection,
      });
      const sessionMaxAge = Date.parse(created.session.expiresAt) - Date.now();
      if (!Number.isFinite(sessionMaxAge) || sessionMaxAge < 1) {
        throw new AuthRequestError(400);
      }
      const csrf = opaqueValue();
      clearHostCookie(response, AUTH_COOKIE_NAMES.transaction, httpOnlyCookie);
      setHostCookie(response, AUTH_COOKIE_NAMES.session, created.handle, {
        ...httpOnlyCookie,
        maxAge: sessionMaxAge,
      });
      setHostCookie(response, AUTH_COOKIE_NAMES.csrf, csrf, {
        ...csrfCookie,
        maxAge: sessionMaxAge,
      });
      response.redirect(303, dependencies.webOrigin);
    } catch (error) {
      if (dependencies.renewal || successorHandle) {
        // Only the still-selected pending/successful login may publish cookies.
        // A stale callback must not even clear the newer transaction/family cookies.
        if (successorHandle && dependencies.renewal) {
          try {
            const current =
              await dependencies.renewal.store.read(successorHandle);
            if (
              current &&
              (current.record.phase === "ENROLLING" ||
                current.record.phase === "ACTIVE")
            ) {
              setFamily(successorHandle, current, response);
              clearLegacyCookies(response, dependencies.secureCookies);
              clearHostCookie(
                response,
                AUTH_COOKIE_NAMES.transaction,
                httpOnlyCookie,
              );
            }
          } catch {
            /* Unavailable lineage never publishes a callback identity. */
          }
        }
      } else
        clearHostCookie(
          response,
          AUTH_COOKIE_NAMES.transaction,
          httpOnlyCookie,
        );
      sendAuthenticationError(
        response,
        error instanceof AuthRequestError && error.status === 403
          ? 403
          : statusFor(error),
      );
    }
  });

  router.get("/me", async (request, response) => {
    if (hasFamilyCookie(request)) {
      try {
        if (!dependencies.renewal) throw unavailable();
        const { handle, csrf } = familyCookies(request);
        if (!(await dependencies.renewal.validateCsrf(handle, csrf, csrf)))
          throw new TfRenewalError("INVALID_REFERENCE");
        const session = await dependencies.renewal.authorize(handle);
        response.json({
          accountId: session.accountId,
          installationId: session.installationId,
          entitlements: session.entitlements,
          expiresAt: session.expiresAt,
          csrfToken: csrf,
        });
      } catch (error) {
        if (error instanceof TfRenewalError && error.terminal)
          clearFamilyCookies(response, dependencies.secureCookies);
        sendAuthenticationError(
          response,
          error instanceof TfRenewalError &&
            (error.status === 401 || error.status === 403)
            ? error.status
            : 503,
        );
      }
      return;
    }
    const handle = cookieValue(request, AUTH_COOKIE_NAMES.session);
    const csrf = cookieValue(request, AUTH_COOKIE_NAMES.csrf);
    if (
      handle === null ||
      !OPAQUE_PATTERN.test(handle) ||
      csrf === null ||
      !OPAQUE_PATTERN.test(csrf)
    ) {
      sendAuthenticationError(response, 401);
      return;
    }
    try {
      const session = await dependencies.sessionStore.getSession(handle);
      if (session === null) {
        sendAuthenticationError(response, 401);
        return;
      }
      response.json({
        accountId: session.accountId,
        installationId: session.installationId,
        entitlements: session.entitlements,
        expiresAt: session.expiresAt,
        csrfToken: csrf,
      });
    } catch {
      sendAuthenticationError(response, 503);
    }
  });

  router.post("/logout", async (request, response) => {
    if (hasFamilyCookie(request)) {
      try {
        requireEmptyRenewalBody(request);
        if (!dependencies.renewal) throw unavailable();
        const { handle, csrf } = familyCookies(request);
        if (
          !(await dependencies.renewal.validateCsrf(
            handle,
            csrf,
            request.get("x-csrf-token") ?? "",
          ))
        ) {
          response
            .status(403)
            .json({ code: "TF_RENEWAL_CSRF_REJECTED", retryable: false });
          return;
        }
        clearFamilyCookies(response, dependencies.secureCookies);
        try {
          await dependencies.renewal.logout(handle);
        } finally {
          await retireLegacy(request);
        }
        response.status(204).end();
      } catch (error) {
        sendLocalRenewalError(response, error);
      }
      return;
    }
    const handle = cookieValue(request, AUTH_COOKIE_NAMES.session);
    if (handle === null || !OPAQUE_PATTERN.test(handle)) {
      sendAuthenticationError(response, 403);
      return;
    }

    let status: 204 | 503 = 204;
    try {
      await dependencies.sessionStore.revokeSession(handle);
    } catch {
      status = 503;
    }
    clearHostCookie(response, AUTH_COOKIE_NAMES.session, httpOnlyCookie);
    clearHostCookie(response, AUTH_COOKIE_NAMES.csrf, csrfCookie);
    clearHostCookie(response, AUTH_COOKIE_NAMES.transaction, httpOnlyCookie);
    if (status === 503) {
      sendAuthenticationError(response, 503);
      return;
    }
    response.status(204).end();
  });

  function requireEmptyRenewalBody(request: Request) {
    if (
      request.originalUrl.includes("?") ||
      !request.body ||
      Array.isArray(request.body) ||
      typeof request.body !== "object" ||
      Object.keys(request.body).length !== 0
    )
      throw new AuthRequestError(400);
  }
  function sendLocalRenewalError(response: Response, error: unknown) {
    if (error instanceof AuthRequestError && error.status === 400) {
      response
        .status(400)
        .json({ code: "TF_RENEWAL_INVALID_REQUEST", retryable: false });
      return;
    }
    sendRenewalError(response, error, dependencies.secureCookies);
  }
  for (const route of ["/renew-context", "/renew"] as const) {
    router.post(route, async (request, response) => {
      try {
        requireEmptyRenewalBody(request);
        if (!dependencies.renewal) throw unavailable();
        const { handle, csrf } = familyCookies(request);
        if (route === "/renew-context") {
          response.json({
            csrf_token: await dependencies.renewal.context(handle, csrf),
          });
          return;
        }
        if (
          !(await dependencies.renewal.validateCsrf(
            handle,
            csrf,
            request.get("x-csrf-token") ?? "",
          ))
        ) {
          response
            .status(403)
            .json({ code: "TF_RENEWAL_CSRF_REJECTED", retryable: false });
          return;
        }
        const renewed = await dependencies.renewal.renew(handle);
        setFamily(handle, renewed, response);
        response.status(204).end();
      } catch (error) {
        sendLocalRenewalError(response, error);
      }
    });
  }
  return router;
}
