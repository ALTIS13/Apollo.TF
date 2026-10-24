import { timingSafeEqual } from "node:crypto";

import type { Request, RequestHandler, Response } from "express";
import {
  TfRenewalError,
  unavailable,
  opaqueSchema,
} from "./tf-renewal-contract.js";
export { TfRenewalConsumer } from "./tf-renewal-consumer.js";

const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UNSAFE_METHODS = new Set(["DELETE", "PATCH", "POST", "PUT"]);

export const AUTH_COOKIE_NAMES = Object.freeze({
  browser: "__Host-apollo_tf_browser",
  family: "__Host-apollo_tf_family",
  familyCsrf: "__Host-apollo_tf_family_csrf",
  installation: "__Host-apollo_tf_installation",
  transaction: "__Host-apollo_tf_tx",
  session: "__Host-apollo_tf",
  csrf: "__Host-apollo_tf_csrf",
});

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  if (cookies === undefined) return null;
  const descriptor = Object.getOwnPropertyDescriptor(cookies, name);
  return descriptor?.get === undefined && typeof descriptor?.value === "string"
    ? descriptor.value
    : null;
}

function canonicalOpaque(value: string): boolean {
  if (!OPAQUE_PATTERN.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.byteLength === 32 && bytes.toString("base64url") === value;
}

function constantTimeOpaqueMatch(left: string, right: string): boolean {
  if (!canonicalOpaque(left) || !canonicalOpaque(right)) return false;
  return timingSafeEqual(
    Buffer.from(left, "base64url"),
    Buffer.from(right, "base64url"),
  );
}

export function hasFamilyCookie(request: Request): boolean {
  return [AUTH_COOKIE_NAMES.family, AUTH_COOKIE_NAMES.familyCsrf].some(
    (name) =>
      Object.hasOwn(request.cookies ?? {}, name) ||
      (request.headers.cookie ?? "")
        .split(";")
        .some((p) => p.trim().startsWith(`${name}=`)),
  );
}
export function familyCookies(request: Request): {
  handle: string;
  csrf: string;
} {
  const names = new Set<string>();
  for (const part of (request.headers.cookie ?? "").split(";")) {
    const name = part.split("=", 1)[0]!.trim();
    if (names.has(name)) throw new TfRenewalError("INVALID_REFERENCE");
    names.add(name);
  }
  const handle = cookieValue(request, AUTH_COOKIE_NAMES.family),
    csrf = cookieValue(request, AUTH_COOKIE_NAMES.familyCsrf);
  if (
    !opaqueSchema.safeParse(handle).success ||
    !opaqueSchema.safeParse(csrf).success
  )
    throw new TfRenewalError("INVALID_REFERENCE");
  return { handle: handle!, csrf: csrf! };
}
export function clearFamilyCookies(response: Response, secure = true) {
  clearLegacyCookies(response, secure);
  response.clearCookie(AUTH_COOKIE_NAMES.family, {
    path: "/",
    secure,
    httpOnly: true,
    sameSite: "lax",
  });
  response.clearCookie(AUTH_COOKIE_NAMES.familyCsrf, {
    path: "/",
    secure,
    httpOnly: false,
    sameSite: "lax",
  });
}
export function clearLegacyCookies(response: Response, secure = true) {
  response.clearCookie(AUTH_COOKIE_NAMES.session, {
    path: "/",
    secure,
    httpOnly: true,
    sameSite: "lax",
  });
  response.clearCookie(AUTH_COOKIE_NAMES.csrf, {
    path: "/",
    secure,
    httpOnly: false,
    sameSite: "lax",
  });
}
export function sendRenewalError(
  response: Response,
  error: unknown,
  secure = true,
) {
  const e = error instanceof TfRenewalError ? error : unavailable();
  if (e.terminal) clearFamilyCookies(response, secure);
  if (e.retryable) response.setHeader("Retry-After", e.retryAfter);
  response.status(e.status).json({ code: e.code, retryable: e.retryable });
}
export function requireTfBrowserMutation(
  webOrigin: string,
  successor = false,
): RequestHandler {
  return (request, response, next) => {
    if (!UNSAFE_METHODS.has(request.method.toUpperCase())) {
      next();
      return;
    }
    if (
      hasFamilyCookie(request) ||
      /^\/api\/auth\/renew(?:-context)?(?:\?|$)/.test(request.originalUrl)
    ) {
      const duplicates = new Set<string>();
      for (let i = 0; i < request.rawHeaders.length; i += 2) {
        const name = request.rawHeaders[i]!.toLowerCase();
        if (
          ![
            "cookie",
            "origin",
            "content-type",
            "x-csrf-token",
            "content-encoding",
          ].includes(name)
        )
          continue;
        if (duplicates.has(name)) {
          response
            .status(403)
            .json({ code: "TF_RENEWAL_CSRF_REJECTED", retryable: false });
          return;
        }
        duplicates.add(name);
      }
      try {
        if (!successor) throw unavailable();
        // Reject foreign navigation/form requests before a cookie error can emit terminal clears.
        if (
          request.get("origin") !== webOrigin ||
          request.get("content-encoding") !== undefined
        ) {
          response
            .status(403)
            .json({ code: "TF_RENEWAL_CSRF_REJECTED", retryable: false });
          return;
        }
        const cookies = familyCookies(request);
        const context =
          request.originalUrl === "/api/auth/renew-context" &&
          request.method === "POST";
        if (
          !context &&
          !constantTimeOpaqueMatch(
            request.get("x-csrf-token") ?? "",
            cookies.csrf,
          )
        ) {
          response
            .status(403)
            .json({ code: "TF_RENEWAL_CSRF_REJECTED", retryable: false });
          return;
        }
        if (
          request.originalUrl.startsWith("/api/auth/") &&
          !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
            request.get("content-type") ?? "",
          )
        ) {
          response
            .status(415)
            .json({ code: "TF_RENEWAL_INVALID_REQUEST", retryable: false });
          return;
        }
        next();
        return;
      } catch (error) {
        sendRenewalError(response, error);
        return;
      }
    }
    const session = cookieValue(request, AUTH_COOKIE_NAMES.session);
    const csrfCookie = cookieValue(request, AUTH_COOKIE_NAMES.csrf);
    const csrfHeader = request.get("x-csrf-token");
    if (
      request.get("origin") !== webOrigin ||
      session === null ||
      !canonicalOpaque(session) ||
      csrfCookie === null ||
      csrfHeader === undefined ||
      !constantTimeOpaqueMatch(csrfHeader, csrfCookie)
    ) {
      response.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}
