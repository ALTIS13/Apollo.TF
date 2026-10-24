import { randomBytes, randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { PlatformAuthClient } from "./platform-auth-client.js";
import { TfFamilyStore } from "./tf-family-store.js";
import { TfRenewalConsumer } from "./tf-renewal-consumer.js";
import {
  memoryFamilyPersistence,
  testBinding,
  testRenewalResult,
} from "./tf-renewal-test-support.js";
import {
  TfFamilyWebSocket,
  type FamilyWsPersistence,
} from "./tf-family-websocket.js";

/** Actual local verification/client/consumer; only HTTP and persistence are controlled. */
export async function wsFamilyFixture() {
  let now = Math.floor(Date.now() / 1000) * 1000;
  const binding = testBinding(),
    keys = await generateKeyPair("EdDSA");
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "ws-test",
    alg: "EdDSA",
  };
  let jti = randomUUID();
  let result = testRenewalResult(binding, now);
  const requests: {
    path: string;
    body: Record<string, unknown>;
    signal?: AbortSignal | null;
  }[] = [];
  let holdCheck: (() => Promise<void>) | null = null;
  let failure: { code: string; status: number; retryable: boolean } | null =
    null;
  let capabilities = ["tf.search"];
  async function signed(nonce: string) {
    return new SignJWT({
      sid: binding.session_id,
      installation_id: binding.installation_id,
      nonce,
      account_status: "active",
      entitlements: ["tf.search", "tf.collections"],
    })
      .setProtectedHeader({ alg: "EdDSA", kid: jwk.kid })
      .setIssuer("https://api.apollot.ru")
      .setAudience("apollo-tf")
      .setSubject(binding.account_id)
      .setJti(jti)
      .setIssuedAt(now / 1000)
      .setNotBefore(now / 1000)
      .setExpirationTime(now / 1000 + 300)
      .sign(keys.privateKey);
  }
  const platform = new PlatformAuthClient({
    issuer: "https://api.apollot.ru",
    clientId: binding.client_id,
    redirectUri: "https://tf.apollot.ru/api/auth/callback",
    clientSecret: "local-ws-test-only",
    fetch: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("jwks.json"))
        return new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { "Content-Type": "application/json" },
        });
      const body = JSON.parse(String(init?.body));
      requests.push({ path, body, signal: init?.signal });
      const sent = new Headers(init?.headers);
      let value: unknown;
      let checkFailure = failure;
      if (path.endsWith("/enroll")) {
        result.token.access_token = await signed(body.nonce);
        value = result;
      } else if (path.endsWith("/renew")) {
        result = testRenewalResult(binding, now, result);
        jti = randomUUID();
        result.token.access_token = await signed(body.nonce);
        value = result;
      } else if (path.endsWith("/check")) {
        if (holdCheck) await holdCheck();
        checkFailure =
          failure ??
          (body.generation !== result.generation ||
          body.family_id !== result.family_id ||
          body.access_assertion !== result.token.access_token
            ? {
                code: "TF_RENEWAL_REFERENCE_SPENT",
                status: 409,
                retryable: false,
              }
            : null);
        value = checkFailure
          ? {
              schema_version: 1,
              contract_id: binding.contract_id,
              code: checkFailure.code,
              retryable: checkFailure.retryable,
            }
          : {
              schema_version: 1,
              contract_id: binding.contract_id,
              family_id: body.family_id,
              generation: body.generation,
              decision: {
                active: true,
                accountId: binding.account_id,
                sessionId: binding.session_id,
                installationId: binding.installation_id,
                accountStatus: "active",
                entitlements: capabilities,
                expiresAt: result.access_expires_at,
              },
            };
      } else
        value = {
          schema_version: 1,
          contract_id: binding.contract_id,
          family_id: result.family_id,
          state: "REVOKED",
          revoked_at: new Date(now).toISOString(),
        };
      return new Response(JSON.stringify(value), {
        status:
          path.endsWith("/check") && checkFailure ? checkFailure.status : 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          "Referrer-Policy": "no-referrer",
          "X-Request-ID": sent.get("X-Request-ID")!,
          "X-Audit-Correlation-ID": sent.get("X-Audit-Correlation-ID")!,
        },
      });
    },
  });
  const persistence = memoryFamilyPersistence(() => now);
  const store = new TfFamilyStore(persistence, () => now);
  const consumer = new TfRenewalConsumer({
    store,
    client: platform.renewal,
    clientId: binding.client_id,
    revocationKeys: {
      active: "test",
      keys: new Map([["test", randomBytes(32)]]),
    },
  });
  const login = await consumer.createLogin();
  await store.beginEnrollment(login.handle, binding, "initial.test.assertion");
  await consumer.renew(login.handle);
  return {
    platform,
    consumer,
    store,
    persistence,
    requests,
    handle: login.handle,
    csrf: login.record.csrf,
    binding,
    get result() {
      return result;
    },
    get jti() {
      return jti;
    },
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
    hold(value: typeof holdCheck) {
      holdCheck = value;
    },
    fail(value: typeof failure) {
      failure = value;
    },
    capabilities(value: string[]) {
      capabilities = value;
    },
  };
}
export async function ticketFixture() {
  const f = await wsFamilyFixture();
  const tickets = new Map<string, { raw: string; expiry: number }>();
  let rate = 0;
  const persistence: FamilyWsPersistence = {
    async allow() {
      return ++rate <= 10;
    },
    async read(key) {
      const value = tickets.get(key);
      return value && value.expiry > f.now() ? value.raw : null;
    },
    async transition(mode, selection, key, raw, expiry) {
      if (
        (await f.persistence.read(selection.key)) !== selection.raw ||
        (await f.persistence.read(selection.lineageKey)) !==
          selection.lineageRaw ||
        expiry <= f.now()
      )
        return false;
      if (mode === "confirm") return true;
      if (mode === "issue") {
        if (tickets.has(key)) return false;
        tickets.set(key, { raw, expiry });
        return true;
      }
      if (tickets.get(key)?.raw !== raw || tickets.get(key)!.expiry <= f.now())
        return false;
      tickets.delete(key);
      return true;
    },
  };
  return {
    f,
    tickets,
    persistence,
    service: new TfFamilyWebSocket(f.consumer, persistence, f.now),
  };
}
