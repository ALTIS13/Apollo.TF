import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import {
  TfFamilyStore,
  type FamilyRecord,
  type FamilyObservation,
  type LoginAuthorization,
} from "./tf-family-store.js";
import {
  familyBinding,
  opaqueSchema,
  revokeSchema,
  TfRenewalError,
  unavailable,
  type TfRenewalClient,
  type RenewalOperation,
  type RevokeRequest,
} from "./tf-renewal-contract.js";
import type { TfSession } from "./tf-session-store.js";

export interface TfRenewalOptions {
  store: TfFamilyStore;
  client: Pick<TfRenewalClient, "enroll" | "renew" | "check" | "revoke">;
  clientId: string;
  revocationKeys: { active: string; keys: ReadonlyMap<string, Uint8Array> };
}
function equals(a: string, b: string) {
  if (!opaqueSchema.safeParse(a).success || !opaqueSchema.safeParse(b).success)
    return false;
  return timingSafeEqual(
    Buffer.from(a, "base64url"),
    Buffer.from(b, "base64url"),
  );
}
export class TfRenewalConsumer {
  readonly store: TfFamilyStore;
  readonly clientId: string;
  private readonly keys = new Map<string, Buffer>();
  constructor(private readonly options: TfRenewalOptions) {
    this.store = options.store;
    this.clientId = options.clientId;
    if (!/^[A-Za-z0-9._~-]{1,128}$/.test(this.clientId)) throw unavailable();
    for (const [id, key] of options.revocationKeys.keys) {
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(id) || key.byteLength !== 32)
        throw unavailable();
      this.keys.set(id, Buffer.from(key));
    }
    if (!this.keys.has(options.revocationKeys.active)) throw unavailable();
  }
  createLogin(lineageId?: string, authorization?: LoginAuthorization) {
    return this.store.createLogin(lineageId, authorization);
  }
  async context(handle: string, csrf: string) {
    const current = await this.store.read(handle);
    if (
      !current ||
      current.record.phase === "CLOSED" ||
      current.record.phase === "LOGIN" ||
      !equals(current.record.csrf, csrf)
    )
      throw new TfRenewalError("INVALID_REFERENCE");
    await this.store.allowContext(handle);
    return current.record.csrf;
  }
  async validateCsrf(handle: string, cookie: string, header: string) {
    const current = await this.store.read(handle);
    if (
      !current ||
      current.record.phase === "CLOSED" ||
      current.record.phase === "LOGIN"
    )
      throw new TfRenewalError("INVALID_REFERENCE");
    if (!equals(current.record.csrf, cookie) || !equals(cookie, header))
      return false;
    return true;
  }
  async renew(handle: string) {
    const existing = await this.store.read(handle);
    if (
      existing?.record.phase === "ACTIVE" &&
      existing.record.operation === null &&
      this.store.now() < Date.parse(existing.record.result.renew_after)
    ) {
      // A repeated browser trigger is not another logical rotation or keepalive.
      await this.authorize(handle);
      const checked = await this.store.read(handle);
      if (!checked || checked.record.phase !== "ACTIVE") throw unavailable();
      return checked;
    }
    const claimed = await this.store.claim(handle),
      record = claimed.record;
    const op = record.operation;
    try {
      const result =
        record.phase === "ENROLLING"
          ? await this.options.client.enroll(
              {
                ...record.binding,
                initial_assertion: record.initialAssertion,
                nonce: op.nonce,
              },
              op,
            )
          : await this.options.client.renew(
              {
                ...familyBinding(record.result),
                family_id: record.result.family_id,
                generation: record.result.generation,
                renewal_reference: record.result.renewal_reference,
                nonce: op.nonce,
              },
              op,
            );
      await this.options.client.check({
        ...familyBinding(result),
        family_id: result.family_id,
        generation: result.generation,
        access_assertion: result.token.access_token,
      });
      return await this.store.complete(handle, claimed, result, (r) =>
        this.seal(r, "LOCAL_SESSION_REPLACED"),
      );
    } catch (error) {
      const failure = error instanceof TfRenewalError ? error : unavailable();
      if (failure.terminal)
        await this.close(handle, "LOCAL_SESSION_REPLACED", claimed);
      else await this.store.release(handle, claimed, failure.retryAfter);
      throw failure;
    }
  }
  async authorize(handle: string): Promise<TfSession> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const current = await this.store.read(handle);
      if (!current || current.record.phase === "CLOSED")
        throw new TfRenewalError("INVALID_REFERENCE");
      const record = current.record;
      if (
        record.phase !== "ACTIVE" ||
        Date.parse(record.result.access_expires_at) <= this.store.now()
      )
        throw new TfRenewalError("ACCESS_EXPIRED");
      const r = record.result;
      try {
        const d = await this.options.client.check({
          ...familyBinding(r),
          family_id: r.family_id,
          generation: r.generation,
          access_assertion: r.token.access_token,
        });
        const observed = await this.store.read(handle);
        if (!observed || observed.record.phase === "CLOSED")
          throw new TfRenewalError("INVALID_REFERENCE");
        if (
          observed.record.phase !== "ACTIVE" ||
          observed.record.id !== record.id
        )
          throw unavailable();
        if (observed.record.result.generation !== r.generation) continue;
        const expiry = Math.min(
          record.expiresAt,
          Date.parse(r.access_expires_at),
          Date.parse(d.expiresAt),
        );
        if (
          !d.active ||
          d.accountId !== r.account_id ||
          d.sessionId !== r.session_id ||
          d.installationId !== r.installation_id ||
          expiry <= this.store.now()
        )
          throw unavailable();
        return {
          id: record.id,
          accountId: r.account_id,
          platformSessionId: r.session_id,
          installationId: r.installation_id,
          entitlements: [...d.entitlements],
          assertionExpiresAt: new Date(expiry).toISOString(),
          expiresAt: new Date(expiry).toISOString(),
        };
      } catch (error) {
        if (
          error instanceof TfRenewalError &&
          error.reason === "REFERENCE_SPENT" &&
          attempt === 0
        )
          continue;
        if (error instanceof TfRenewalError && error.terminal)
          await this.close(handle, "LOCAL_SESSION_REPLACED", current);
        throw error instanceof TfRenewalError ? error : unavailable();
      }
    }
    throw unavailable();
  }
  private seal(
    record: Extract<FamilyRecord, { phase: "ACTIVE" }>,
    reason: RevokeRequest["reason"],
  ): string {
    const r = record.result;
    const request: RevokeRequest = {
      ...familyBinding(r),
      family_id: r.family_id,
      generation: r.generation,
      renewal_reference: r.renewal_reference,
      reason,
    };
    const operation: RenewalOperation = {
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
    };
    const nonce = randomBytes(12),
      keyId = this.options.revocationKeys.active;
    const cipher = createCipheriv("aes-256-gcm", this.keys.get(keyId)!, nonce);
    cipher.setAAD(
      Buffer.from(`tf-d05-revoke:v1:${record.id}:${record.expiresAt}`),
    );
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify({ request, operation }), "utf8"),
      cipher.final(),
    ]);
    return JSON.stringify({
      keyId,
      nonce: nonce.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
    });
  }
  private close(
    handle: string,
    reason: RevokeRequest["reason"],
    expected?: FamilyObservation,
    wholeBrowser = false,
  ) {
    return this.store.close(
      handle,
      (r) => this.seal(r, reason),
      expected,
      wholeBrowser,
    );
  }
  async logout(
    handle: string,
    reason: RevokeRequest["reason"] = "USER_LOGOUT",
  ) {
    await this.close(handle, reason, undefined, true);
    await this.drainRevocations();
    const r = await this.store.read(handle);
    if (r?.record.phase === "CLOSED" && r.record.revocation)
      throw unavailable();
    if (r?.record.phase === "CLOSED" && r.record.retiredHandle) {
      const retired = await this.store.read(r.record.retiredHandle);
      if (retired?.record.phase === "CLOSED" && retired.record.revocation)
        throw unavailable();
    }
  }
  /** Runtime scheduler may call this bounded, durable revoke-only outbox drain. */
  async drainRevocations() {
    for (const { key, observation } of await this.store.pendingRevocations()) {
      try {
        const e = z
          .object({
            keyId: z.string(),
            nonce: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
            tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
            ciphertext: z.string().min(1).max(20000),
          })
          .strict()
          .parse(JSON.parse(observation.record.revocation!));
        const decryptKey = this.keys.get(e.keyId);
        if (!decryptKey) throw unavailable();
        const decipher = createDecipheriv(
          "aes-256-gcm",
          decryptKey,
          Buffer.from(e.nonce, "base64url"),
        );
        decipher.setAAD(
          Buffer.from(
            `tf-d05-revoke:v1:${observation.record.id}:${observation.record.expiresAt}`,
          ),
        );
        decipher.setAuthTag(Buffer.from(e.tag, "base64url"));
        const value = JSON.parse(
          Buffer.concat([
            decipher.update(Buffer.from(e.ciphertext, "base64url")),
            decipher.final(),
          ]).toString("utf8"),
        );
        const packet = z
          .object({
            request: revokeSchema,
            operation: z
              .object({
                idempotencyKey: z.string().uuid(),
                correlationId: z.string().uuid(),
              })
              .strict(),
          })
          .strict()
          .parse(value);
        await this.options.client.revoke(packet.request, packet.operation);
        await this.store.acknowledgeRevoke(key, observation);
      } catch {
        /* Leave encrypted work for the next bounded drain, never renew it. */
      }
    }
  }
}
