import { Router, type IRouter, type Request } from "express";
import {
  familyCookies,
  hasFamilyCookie,
  sendRenewalError,
} from "../lib/tf-browser-session.js";
import type { TfFamilyWebSocket } from "../lib/tf-family-websocket.js";
import { unavailable } from "../lib/tf-renewal-contract.js";

import {
  TfSessionNotFoundError,
  type TfSessionStore,
} from "../lib/tf-session-store.js";

const TF_SESSION_COOKIE_NAME = "__Host-apollo_tf";
const OPAQUE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface WebSocketTicketRouteDependencies {
  readonly issueWebSocketTicket: Pick<
    TfSessionStore,
    "issueWebSocketTicket"
  >["issueWebSocketTicket"];
}

function canonicalOpaque(value: string): boolean {
  if (!OPAQUE_PATTERN.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.byteLength === 32 && bytes.toString("base64url") === value;
}

function sessionHandle(request: Request): string | null {
  const cookies = request.cookies as Record<string, unknown> | undefined;
  if (cookies === undefined) return null;
  const descriptor = Object.getOwnPropertyDescriptor(
    cookies,
    TF_SESSION_COOKIE_NAME,
  );
  if (
    descriptor === undefined ||
    descriptor.get !== undefined ||
    typeof descriptor.value !== "string" ||
    !canonicalOpaque(descriptor.value)
  ) {
    return null;
  }
  return descriptor.value;
}

function hasExactEmptyInput(request: Request): boolean {
  if (request.originalUrl.includes("?")) return false;
  if (request.headers["transfer-encoding"] !== undefined) return false;
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined && contentLength !== "0") return false;
  const body = request.body as unknown;
  if (body === undefined) return true;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return false;
  }
  try {
    return Object.keys(body).length === 0;
  } catch {
    return false;
  }
}

/** Family-only route owns its complete live capability gate, before the legacy policy/router. */
export function createFamilyWebSocketTicketRouter(dependencies: {
  webOrigin: string;
  service?: TfFamilyWebSocket;
}): IRouter {
  const router = Router();
  router.post("/ws/tickets", async (request, response, next) => {
    if (!hasFamilyCookie(request)) {
      next();
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Referrer-Policy", "no-referrer");
    const seen = new Set<string>();
    for (let n = 0; n < request.rawHeaders.length; n += 2) {
      const name = request.rawHeaders[n]!.toLowerCase();
      if (
        ![
          "origin",
          "cookie",
          "x-csrf-token",
          "content-length",
          "transfer-encoding",
          "content-type",
          "content-encoding",
        ].includes(name)
      )
        continue;
      if (seen.has(name)) {
        response
          .status(400)
          .json({ code: "TF_RENEWAL_INVALID_REQUEST", retryable: false });
        return;
      }
      seen.add(name);
    }
    if (request.get("origin") !== dependencies.webOrigin) {
      response
        .status(403)
        .json({ code: "TF_RENEWAL_CSRF_REJECTED", retryable: false });
      return;
    }
    if (
      !hasExactEmptyInput(request) ||
      request.headers["content-encoding"] !== undefined
    ) {
      response
        .status(400)
        .json({ code: "TF_RENEWAL_INVALID_REQUEST", retryable: false });
      return;
    }
    const abort = new AbortController();
    const cancel = () => abort.abort();
    request.once("aborted", cancel);
    response.once("close", cancel);
    const timeout = setTimeout(cancel, 10_000);
    try {
      if (!dependencies.service) throw unavailable();
      const { handle, csrf } = familyCookies(request);
      const ticket = await dependencies.service.issue(
        handle,
        csrf,
        request.get("x-csrf-token") ?? "",
        abort.signal,
      );
      if (!abort.signal.aborted) response.status(201).json({ ticket });
    } catch (error) {
      if (!abort.signal.aborted) sendRenewalError(response, error);
      else if (!response.destroyed && !response.writableEnded)
        sendRenewalError(response, unavailable());
    } finally {
      clearTimeout(timeout);
      request.off("aborted", cancel);
      response.off("close", cancel);
    }
  });
  return router;
}

export function createWebSocketTicketRouter(
  dependencies: WebSocketTicketRouteDependencies,
): IRouter {
  const router: IRouter = Router();

  router.post("/ws/tickets", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!hasExactEmptyInput(request)) {
      response.status(400).json({ error: "invalid_request" });
      return;
    }
    const handle = sessionHandle(request);
    if (handle === null) {
      response.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const ticket = await dependencies.issueWebSocketTicket(handle);
      if (!canonicalOpaque(ticket)) {
        throw new Error("invalid ticket");
      }
      response.status(201).json({ ticket });
    } catch (error) {
      if (error instanceof TfSessionNotFoundError) {
        response.status(401).json({ error: "unauthorized" });
        return;
      }
      response.status(503).json({ error: "policy_unavailable" });
    }
  });

  return router;
}
