import type { NextFunction, Request, Response } from "express";
import { createSignedBodySignature } from "@workspace/module-runtime-contract";
import {
  TF_SOURCE_REFERENCE_PATH, canonicalSourceKey, type TfSourceReferenceResponse,
} from "@workspace/tf-search-contract/source-reference";
import { describe, expect, it } from "vitest";
import { createTfSearchApp } from "./app.js";
import { HmacInternalRequestAuthenticator } from "./internal-auth.js";
import type { SearchService } from "./search-service.js";

const secret = "source-reference-test-fixture-only";
const command = { schemaVersion: 1, requestId: "10000000-0000-4000-8000-000000000001",
  accountId: "20000000-0000-4000-8000-000000000002", sourceUrl: "https://youtube.com/watch?v=Ap0ll0Tf001" };
const known: TfSourceReferenceResponse = {
  schemaVersion: 1, requestId: command.requestId, sourceKey: canonicalSourceKey(command.sourceUrl)!, status: "known",
  reference: { artist: "Artist", title: "Track (Clean)", type: "original", expectedDurationSeconds: 210,
    provenance: "catalog", observedAt: 1_000, expiresAt: 301_000 },
};

function injected(sourceReference?: SearchService["sourceReference"]): SearchService {
  const unused = async (): Promise<never> => { throw new Error("Unexpected search operation"); };
  return { search: unused, freeSearch: unused, discoverArtist: unused, suggestions: unused,
    telemetry: () => ({ requestsPerMinute: 0, status: "healthy" }),
    ...(sourceReference ? { sourceReference } : {}),
  };
}

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
async function dispatch(service: SearchService, options: { body?: unknown; signed?: boolean; ready?: boolean } = {}) {
  const app = createTfSearchApp({ service, auth: new HmacInternalRequestAuthenticator({ secret }), ready: () => options.ready ?? true });
  // Exercise the registered signed handler with an exact raw body; no sockets or provider network.
  const router = app as unknown as { router: { stack: Array<{ route?: { path: string; stack: Array<{ handle: Handler }> } }> } };
  const route = router.router.stack.find((entry) => entry.route?.path === TF_SOURCE_REFERENCE_PATH)?.route;
  let status = 404;
  let body: unknown;
  if (!route) return { status, body };
  const raw = Buffer.from(JSON.stringify(options.body ?? command));
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const nonce = "A".repeat(43);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.signed !== false) Object.assign(headers, {
    "x-apollo-internal-timestamp": timestamp, "x-apollo-internal-nonce": nonce,
    "x-apollo-internal-signature": createSignedBodySignature({ method: "POST", path: TF_SOURCE_REFERENCE_PATH, timestamp, nonce, rawBody: raw, secret }),
  });
  const req = { method: "POST", originalUrl: TF_SOURCE_REFERENCE_PATH, body: raw,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const res = { status: (code: number) => { status = code; return res; },
    json: (value: unknown) => { body = value; return res; },
  } as unknown as Response;
  await route.stack.at(-1)!.handle(req, res, (() => {}) as NextFunction);
  return { status, body };
}

describe("private signed source-reference endpoint", () => {
  it("dispatches authenticated account/source correlation and returns a strict private reference", async () => {
    let received: unknown;
    const result = await dispatch(injected(async (input) => { received = input; return known; }));
    expect(result).toEqual({ status: 200, body: known });
    expect(received).toEqual(command);
  });

  it.each(["missing_method", "service_failure", "malformed_response", "not_ready"] as const)(
    "fails closed instead of returning an unknown reference on %s", async (reason) => {
      const service = reason === "missing_method" ? injected() : injected(async () => {
        if (reason === "service_failure") throw new Error("Lookup unavailable");
        if (reason === "malformed_response") return { ...known, reference: undefined } as unknown as TfSourceReferenceResponse;
        return known;
      });
      expect(await dispatch(service, { ready: reason !== "not_ready" })).toEqual({ status: 503, body: { error: "search_unavailable" } });
    },
  );

  it("requires existing signed authentication before invoking the private lookup", async () => {
    let calls = 0;
    const result = await dispatch(injected(async () => { calls += 1; return known; }), { signed: false });
    expect(result).toEqual({ status: 401, body: { error: "unauthorized" } });
    expect(calls).toBe(0);
  });

  it("rejects authenticated caller-supplied recording metadata before lookup", async () => {
    let calls = 0;
    const result = await dispatch(injected(async () => { calls += 1; return known; }), { body: { ...command, title: "Forged recording" } });
    expect(result).toEqual({ status: 400, body: { error: "invalid_request" } });
    expect(calls).toBe(0);
  });
});
