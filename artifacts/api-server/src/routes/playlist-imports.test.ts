import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  GetPlaylistImportResponse,
  ListPlaylistImportsResponse,
  PutPlaylistImportBody,
  PutPlaylistImportParams,
} from "@workspace/api-zod";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiApp } from "../app.js";
import { PlatformAuthClient } from "../lib/platform-auth-client.js";
import { requiredPolicyForRequest } from "../lib/tf-policy.js";
import type { TfSession, TfSessionStore } from "../lib/tf-session-store.js";

vi.hoisted(() => {
  process.env["DATABASE_URL"] ??= "postgres://unused:unused@127.0.0.1:1/unused";
});

const accountId = "10000000-0000-4000-8000-000000000001";
const otherAccountId = "90000000-0000-4000-8000-000000000009";
const platformSessionId = "20000000-0000-4000-8000-000000000002";
const installationId = "30000000-0000-4000-8000-000000000003";
const importId = "abcdef01-2345-4789-abcd-ef0123456789";
const collectionPath = "/api/collections/imports";
const draftPath = `${collectionPath}/${importId}`;
const webOrigin = "https://tf.example.test";
const normalized = {
  name: "Draft",
  source: "spotify_album" as const,
  entries: [{ artist: "Artist", title: "Track \u{1F3B5}", durationSeconds: null }],
};
const { entries, ...metadata } = normalized;
const summary = {
  ...metadata,
  id: importId,
  entryCount: 1,
  createdAt: "2026-09-04T20:01:00.000Z",
};
const draft = { ...summary, entries };
const servers: Server[] = [];

async function startApp() {
  const store = {
    list: vi.fn().mockResolvedValue([summary]),
    get: vi.fn().mockResolvedValue(draft),
    put: vi.fn().mockResolvedValue({ status: "created", draft }),
    remove: vi.fn().mockResolvedValue(true),
  };
  const opaque = () => randomBytes(32).toString("base64url");
  const transactionHandle = opaque();
  const handle = opaque();
  const state = opaque();
  const nonce = opaque();
  const issuer = "https://platform.example.test";
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  const kid = "test-platform-key";
  const assertion = await new SignJWT({
    sid: platformSessionId,
    installation_id: installationId,
    nonce,
    account_status: "active",
    entitlements: ["tf.collections"],
  })
    .setProtectedHeader({ alg: "EdDSA", kid, typ: "JWT" })
    .setIssuer(issuer)
    .setAudience("apollo-tf")
    .setSubject(accountId)
    .setJti(randomUUID())
    .setIssuedAt()
    .setNotBefore("0s")
    .setExpirationTime("5m")
    .sign(privateKey);
  const expiresAt = new Date(Date.now() + 300_000).toISOString();
  const introspected: unknown[] = [];
  let liveEntitlements = ["tf.collections"];
  const clientSecret = opaque();
  const platform = new PlatformAuthClient({
    issuer,
    clientId: "apollo-tf",
    clientSecret,
    redirectUri: "https://api.tf.example.test/api/auth/callback",
    fetch: async (input, init) => {
      switch (new URL(String(input)).pathname) {
        case "/.well-known/jwks.json":
          return Response.json({
            keys: [{ ...(await exportJWK(publicKey)), kid }],
          });
        case "/v1/oauth/token":
          return Response.json({
            access_token: assertion,
            token_type: "Bearer",
            expires_in: 300,
          });
        case "/v1/oauth/introspect":
          expect(new Headers(init?.headers).get("authorization")).toBe(
            `Basic ${Buffer.from(`apollo-tf:${clientSecret}`).toString("base64")}`,
          );
          introspected.push(JSON.parse(String(init?.body)));
          return Response.json({
            active: true,
            accountId,
            sessionId: platformSessionId,
            installationId,
            accountStatus: "active",
            entitlements: liveEntitlements,
            expiresAt,
          });
        default:
          throw new Error("unexpected Platform request");
      }
    },
  });
  let session: TfSession;
  const sessionStore = {
    createTransaction: vi.fn(),
    consumeTransaction: vi.fn(async (value: string) =>
      value === transactionHandle
        ? {
            state,
            nonce,
            codeVerifier: opaque(),
            installationId,
            installationLabel: "Test",
            createdAt: new Date().toISOString(),
            expiresAt,
          }
        : null,
    ),
    createSession: vi.fn<TfSessionStore["createSession"]>(
      async ({ assertionClaims }) => {
        session = {
          id: randomUUID(),
          accountId: assertionClaims.sub,
          platformSessionId: assertionClaims.sid,
          installationId: assertionClaims.installation_id,
          entitlements: assertionClaims.entitlements,
          assertionExpiresAt: new Date(Date.now() + 120_000).toISOString(),
          expiresAt,
        };
        return { handle, session };
      },
    ),
    getSession: vi.fn(),
    observeSession: vi.fn(async (value: string) =>
      value === handle ? { session, revision: opaque() } : null,
    ),
    refreshSession: vi.fn(async () => session),
    revokeSession: vi.fn(),
    issueProviderOAuthState: vi.fn(),
    consumeProviderOAuthState: vi.fn(),
    issueWebSocketTicket: vi.fn(),
    consumeWebSocketTicket: vi.fn(),
  };
  const app = createApiApp({
    auth: { platform, sessionStore, webOrigin, secureCookies: true },
    playlistImports: { store },
  });
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const callback = await fetch(
    `${origin}/api/auth/callback?code=${opaque()}&state=${state}`,
    {
      redirect: "manual",
      headers: { cookie: `__Host-apollo_tf_tx=${transactionHandle}` },
    },
  );
  expect(callback.status).toBe(303);
  const cookie = callback.headers
    .getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  const csrf = /__Host-apollo_tf_csrf=([A-Za-z0-9_-]+)/.exec(cookie)?.[1];
  expect(csrf).toBeDefined();

  function request(path: string, init: RequestInit = {}) {
    const headers = new Headers({
      cookie,
      origin: webOrigin,
      "content-type": "application/json",
      "x-csrf-token": csrf!,
      "x-account-id": otherAccountId,
    });
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    return fetch(`${origin}${path}`, { ...init, headers });
  }
  return {
    request,
    store,
    introspected,
    revokeCollections: () => {
      liveEntitlements = ["tf.search"];
    },
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function expectJson(response: Response, status: number, body: unknown) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual(body);
}

describe("playlist import drafts HTTP", () => {
  it("generates strict metadata-only contracts for the import routes", () => {
    expect(PutPlaylistImportParams.parse({ importId })).toEqual({ importId });
    expect(
      PutPlaylistImportParams.safeParse({ importId: importId.toUpperCase() })
        .success,
    ).toBe(false);
    expect(PutPlaylistImportBody.parse(normalized)).toEqual(normalized);
    for (const entry of [
      { ...entries[0], durationSeconds: 1.5 },
      { ...entries[0], providerUrl: "https://example.test/track" },
      { ...entries[0], title: " " },
      { ...entries[0], title: "Lone surrogate \uD800" },
    ]) {
      expect(
        PutPlaylistImportBody.safeParse({ ...normalized, entries: [entry] })
          .success,
      ).toBe(false);
    }
    expect(ListPlaylistImportsResponse.parse({ imports: [summary] })).toEqual({
      imports: [summary],
    });
    expect(
      ListPlaylistImportsResponse.safeParse({ imports: [draft] }).success,
    ).toBe(false);
    expect(GetPlaylistImportResponse.parse({ draft })).toEqual({ draft });
  });

  it("binds all four methods to the signed account and maps store outcomes", async () => {
    const { request, store, introspected } = await startApp();
    await expectJson(await request(collectionPath), 200, {
      imports: [summary],
    });
    await expectJson(await request(draftPath), 200, { draft });
    const body = JSON.stringify({
      ...normalized,
      name: " Draft ",
      entries: [
        {
          artist: " Artist ",
          title: ` ${entries[0]!.title} `,
          durationSeconds: null,
        },
      ],
    });
    const put = (payload = body) =>
      request(draftPath, { method: "PUT", body: payload });
    await expectJson(await put(), 201, { draft });
    store.put.mockResolvedValueOnce({ status: "existing", draft });
    await expectJson(await put(), 200, { draft });
    store.put.mockResolvedValueOnce({ status: "conflict" });
    const changed = { ...normalized, name: "Different" };
    await expectJson(await put(JSON.stringify(changed)), 409, {
      error: "import_conflict",
    });
    store.put.mockResolvedValueOnce({ status: "limit" });
    await expectJson(await put(), 409, { error: "import_limit" });
    store.get.mockResolvedValueOnce(null);
    await expectJson(await request(draftPath), 404, {
      error: "import_not_found",
    });
    store.remove.mockResolvedValueOnce(false);
    await expectJson(await request(draftPath, { method: "DELETE" }), 404, {
      error: "import_not_found",
    });
    const removed = await request(draftPath, { method: "DELETE" });
    expect(removed.status).toBe(204);
    expect(removed.headers.get("cache-control")).toBe("no-store");
    expect(await removed.text()).toBe("");
    expect(store.list.mock.calls).toEqual([[accountId]]);
    expect(store.get.mock.calls).toEqual(Array(2).fill([accountId, importId]));
    expect(store.put.mock.calls).toEqual([
      [accountId, importId, normalized],
      [accountId, importId, normalized],
      [accountId, importId, changed],
      [accountId, importId, normalized],
    ]);
    expect(store.remove.mock.calls).toEqual(
      Array(2).fill([accountId, importId]),
    );
    expect(introspected).toHaveLength(10);
    for (const input of introspected) {
      expect(input).toEqual({
        accountId,
        sessionId: platformSessionId,
        installationId,
        audience: "apollo-tf",
      });
    }
  });

  it("requires a signed session and live collections entitlement for all four routes", async () => {
    const { request, store, revokeCollections, introspected } =
      await startApp();
    await expectJson(
      await request(collectionPath, { headers: { cookie: "" } }),
      401,
      { error: "unauthorized" },
    );
    expect(introspected).toHaveLength(1);
    revokeCollections();
    for (const [method, path] of [
      ["GET", collectionPath],
      ["GET", draftPath],
      ["PUT", draftPath],
      ["DELETE", draftPath],
    ] as const) {
      expect(requiredPolicyForRequest(method, path)).toMatchObject({
        capability: "tf.collections",
        live: true,
      });
      await expectJson(await request(path, { method }), 403, {
        error: "module_access_denied",
      });
    }
    expect(introspected).toHaveLength(5);
    for (const method of Object.values(store))
      expect(method).not.toHaveBeenCalled();
    expect(requiredPolicyForRequest("POST", collectionPath)).toBeNull();
    expect(requiredPolicyForRequest("GET", `${draftPath}/extra`)).toBeNull();
  });

  it("denies mutations without valid browser CSRF before policy or storage", async () => {
    const { request, store, introspected } = await startApp();
    for (const method of ["PUT", "DELETE"]) {
      const denied = await request(draftPath, {
        method,
        headers: { "x-csrf-token": "incorrect" },
      });
      await expectJson(denied, 403, { error: "forbidden" });
    }
    expect(introspected).toHaveLength(1);
    expect(store.put).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  });

  it("rejects noncanonical IDs, account hints, and invalid metadata before storage", async () => {
    const { request, store } = await startApp();
    for (const method of ["GET", "PUT", "DELETE"]) {
      for (const id of [
        "not-a-uuid",
        "%ZZ",
        importId.toUpperCase(),
        `%61${importId.slice(1)}`,
      ]) {
        await expectJson(
          await request(`${collectionPath}/${id}`, { method }),
          400,
          { error: "bad_request" },
        );
      }
    }
    await expectJson(
      await request(`${collectionPath}?accountId=${otherAccountId}`),
      400,
      { error: "bad_request" },
    );
    for (const body of [
      { ...normalized, accountId: otherAccountId },
      { ...normalized, name: "  " },
      { ...normalized, name: "Null\u0000byte" },
      { ...normalized, name: "x".repeat(201) },
      { ...normalized, source: "spotify" },
      { ...normalized, entries: [] },
      { ...normalized, entries: Array(201).fill(entries[0]) },
      ...[
        { ...entries[0], url: "https://example.test/track" },
        { ...entries[0], id: "provider-id" },
        { artist: "Artist", title: "Track" },
        { ...entries[0], artist: "x".repeat(301) },
        { ...entries[0], title: "x".repeat(501) },
        { ...entries[0], title: "Null\u0000byte" },
        { ...entries[0], title: "Lone surrogate \uD800" },
        ...[0, 86_401, 1.5, "180"].map((durationSeconds) => ({
          ...entries[0],
          durationSeconds,
        })),
      ].map((entry) => ({ ...normalized, entries: [entry] })),
    ]) {
      await expectJson(
        await request(draftPath, { method: "PUT", body: JSON.stringify(body) }),
        400,
        { error: "bad_request" },
      );
    }
    for (const method of Object.values(store))
      expect(method).not.toHaveBeenCalled();
  });

  it("bounds normalized UTF-8 JSON separately from the app parser", async () => {
    const { request, store } = await startApp();
    const body = JSON.stringify({
      ...normalized,
      entries: Array(94).fill({
        artist: "Artist",
        title: "\u00e9".repeat(500),
        durationSeconds: 86_400,
      }),
    });
    expect(Buffer.byteLength(body)).toBeGreaterThan(90 * 1024);
    expect(Buffer.byteLength(body)).toBeLessThan(100 * 1024);
    await expectJson(await request(draftPath, { method: "PUT", body }), 413, {
      error: "request_too_large",
    });
    expect(store.put).not.toHaveBeenCalled();
    const padded = `${JSON.stringify(normalized)}${" ".repeat(93 * 1024)}`;
    await expectJson(
      await request(draftPath, { method: "PUT", body: padded }),
      201,
      { draft },
    );
    expect(store.put).toHaveBeenCalledExactlyOnceWith(
      accountId,
      importId,
      normalized,
    );
  });

  it("keeps early raw parser errors out of caches and storage", async () => {
    const { request, store } = await startApp();
    await expectJson(
      await request(draftPath, { method: "PUT", body: " ".repeat(101 * 1024) }),
      413,
      { error: "request_too_large" },
    );
    await expectJson(
      await request(draftPath, { method: "PUT", body: "{" }),
      400,
      { error: "invalid_request" },
    );
    expect(store.put).not.toHaveBeenCalled();
  });
});
