import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { SelectedFamilyObservation } from "./tf-family-store.js";
import type { StrictRedisClient } from "./tf-session-store.js";
import type { TfRenewalConsumer } from "./tf-renewal-consumer.js";
import {
  awaitReadOnly,
  opaqueSchema,
  parseRenewalJson,
  TfRenewalError,
  unavailable,
} from "./tf-renewal-contract.js";

const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const ticketKey = (s: string) =>
  `tf-auth:{families}:ws-ticket:${digest(opaqueSchema.parse(s))}`;
const millis = z.number().int().nonnegative().safe();
const schema = z
  .object({
    version: z.literal(1),
    kind: z.literal("family-ws"),
    audience: z.literal("apollo-tf"),
    purpose: z.literal("player-sync"),
    handle: opaqueSchema,
    handleDigest: z.string().regex(/^[a-f0-9]{64}$/),
    localId: z.string().uuid(),
    familyId: z.string().uuid(),
    generation: z.number().int().nonnegative(),
    assertionJti: z.string().uuid(),
    assertionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    accountId: z.string().uuid(),
    platformSessionId: z.string().uuid(),
    installationId: z.string().uuid(),
    clientId: z.string().min(1).max(128),
    createdAt: millis,
    expiresAt: millis,
    accessExpiresAt: millis,
    absoluteExpiresAt: millis,
  })
  .strict();
export type FamilyWsTicket = z.infer<typeof schema>;
export type FamilyWsAuthorization = Awaited<
  ReturnType<TfRenewalConsumer["authorizeWebSocket"]>
>;
export interface FamilyWsPersistence {
  allow(handle: string): Promise<boolean>;
  read(key: string): Promise<string | null>;
  transition(
    mode: "issue" | "consume" | "confirm",
    selection: SelectedFamilyObservation,
    key: string,
    raw: string,
    expiry: number,
  ): Promise<boolean>;
}

const TRANSITION = `-- tf-family-ws-v1
local t = redis.call('TIME')
local now = tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
if redis.call('GET',KEYS[1]) ~= ARGV[2] or redis.call('GET',KEYS[2]) ~= ARGV[3] then return 0 end
local expiry = tonumber(ARGV[5])
local a = redis.call('PTTL',KEYS[1]); local b = redis.call('PTTL',KEYS[2])
if not expiry or expiry <= now or a <= 0 or b <= 0 then return 0 end
if ARGV[1] == 'confirm' then return 1 end
if ARGV[1] == 'issue' then
  if expiry > now+30000 then return 0 end
  if now+a < expiry or now+b < expiry then return 0 end
  if redis.call('SET',KEYS[3],ARGV[4],'PXAT',expiry,'NX') then return 1 else return 0 end
end
if ARGV[1] ~= 'consume' then return -1 end
if redis.call('GET',KEYS[3]) ~= ARGV[4] or redis.call('PTTL',KEYS[3]) <= 0 then return 0 end
redis.call('DEL',KEYS[3]); return 1`;

export function redisFamilyWsPersistence(
  redis: StrictRedisClient,
): FamilyWsPersistence {
  return {
    read: (key) => redis.get(key),
    async allow(handle) {
      const value = await redis.eval(
        `-- tf-family-ws-rate-v1
local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],60000) end; return n`,
        1,
        `tf-auth:{families}:ws-ticket-rate:${digest(opaqueSchema.parse(handle))}`,
      );
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 1
      )
        throw unavailable();
      return value <= 10;
    },
    async transition(mode, selection, key, raw, expiry) {
      const value = await redis.eval(
        TRANSITION,
        3,
        selection.key,
        selection.lineageKey,
        key || selection.key,
        mode,
        selection.raw,
        selection.lineageRaw,
        raw,
        expiry,
      );
      if (value !== 0 && value !== 1) throw unavailable();
      return value === 1;
    },
  };
}

export class TfFamilyWebSocket {
  constructor(
    readonly consumer: TfRenewalConsumer,
    private readonly persistence: FamilyWsPersistence,
    private readonly clock: () => number = Date.now,
  ) {}
  private now() {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0) throw unavailable();
    return value;
  }
  private async custody(
    handle: string,
    cookie: string,
    header: string,
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) throw unavailable();
    if (
      !(await awaitReadOnly(
        this.consumer.validateCsrf(handle, cookie, header),
        signal,
      ))
    )
      throw new TfRenewalError("ACCESS_DENIED");
  }
  private async authorize(handle: string, signal?: AbortSignal) {
    const auth = await this.consumer.authorizeWebSocket(handle, signal);
    if (!auth.session.entitlements.includes("tf.search"))
      throw new TfRenewalError("ACCESS_DENIED");
    return auth;
  }
  async issue(
    handle: string,
    cookie: string,
    header: string,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      await this.custody(handle, cookie, header, signal);
      if (!(await awaitReadOnly(this.persistence.allow(handle), signal)))
        throw new TfRenewalError("RATE_LIMITED", 30);
      const auth = await this.authorize(handle, signal);
      const r = auth.selection.record.result;
      const now = this.now(),
        accessExpiresAt = Date.parse(auth.session.expiresAt),
        absoluteExpiresAt = Math.min(
          auth.selection.record.expiresAt,
          Date.parse(r.absolute_expires_at),
        );
      const expiresAt = Math.min(
        now + 30_000,
        accessExpiresAt,
        absoluteExpiresAt,
      );
      if (expiresAt <= now) throw new TfRenewalError("ACCESS_EXPIRED");
      const record = schema.parse({
        version: 1,
        kind: "family-ws",
        audience: "apollo-tf",
        purpose: "player-sync",
        handle,
        handleDigest: digest(handle),
        localId: auth.session.id,
        familyId: r.family_id,
        generation: r.generation,
        assertionJti: auth.assertionJti,
        assertionDigest: digest(r.token.access_token),
        accountId: auth.session.accountId,
        platformSessionId: auth.session.platformSessionId,
        installationId: auth.session.installationId,
        clientId: r.client_id,
        createdAt: now,
        expiresAt,
        accessExpiresAt,
        absoluteExpiresAt,
      });
      const ticket = randomBytes(32).toString("base64url");
      if (
        !(await awaitReadOnly(
          this.persistence.transition(
            "issue",
            auth.selection,
            ticketKey(ticket),
            JSON.stringify(record),
            expiresAt,
          ),
          signal,
        ))
      )
        throw unavailable();
      if (signal?.aborted) throw unavailable();
      return ticket;
    } catch (e) {
      throw e instanceof TfRenewalError ? e : unavailable();
    }
  }
  async consume(
    ticket: string,
    handle: string,
    csrf: string,
    signal?: AbortSignal,
  ): Promise<FamilyWsTicket> {
    try {
      await this.custody(handle, csrf, csrf, signal);
      const key = ticketKey(ticket),
        raw = await awaitReadOnly(this.persistence.read(key), signal);
      if (raw === null) throw new TfRenewalError("INVALID_REFERENCE");
      if (raw.length > 4096) throw unavailable();
      const record = schema.parse(parseRenewalJson(raw)),
        now = this.now();
      if (
        record.handle !== handle ||
        record.handleDigest !== digest(handle) ||
        record.createdAt > now ||
        record.expiresAt <= now ||
        record.expiresAt > record.createdAt + 30_000 ||
        record.expiresAt > record.accessExpiresAt ||
        record.expiresAt > record.absoluteExpiresAt
      )
        throw new TfRenewalError("INVALID_REFERENCE");
      const auth = await this.validate(record, signal);
      if (
        !(await awaitReadOnly(
          this.persistence.transition(
            "consume",
            auth.selection,
            key,
            raw,
            record.expiresAt,
          ),
          signal,
        ))
      )
        throw new TfRenewalError("REFERENCE_SPENT");
      await this.confirm(auth, signal);
      return {
        ...record,
        accessExpiresAt: Math.min(
          record.accessExpiresAt,
          Date.parse(auth.session.expiresAt),
        ),
      };
    } catch (e) {
      throw e instanceof TfRenewalError ? e : unavailable();
    }
  }
  async validate(
    ticket: FamilyWsTicket,
    signal?: AbortSignal,
  ): Promise<FamilyWsAuthorization> {
    const now = this.now();
    if (now >= ticket.absoluteExpiresAt)
      throw new TfRenewalError("FAMILY_EXPIRED");
    if (now >= ticket.accessExpiresAt)
      throw new TfRenewalError("ACCESS_EXPIRED");
    const auth = await this.authorize(ticket.handle, signal),
      r = auth.selection.record.result;
    if (
      auth.session.id !== ticket.localId ||
      auth.session.accountId !== ticket.accountId ||
      auth.session.platformSessionId !== ticket.platformSessionId ||
      auth.session.installationId !== ticket.installationId ||
      r.family_id !== ticket.familyId ||
      r.client_id !== ticket.clientId ||
      r.audience !== ticket.audience
    )
      throw new TfRenewalError("INVALID_REFERENCE");
    if (
      r.generation !== ticket.generation ||
      auth.assertionJti !== ticket.assertionJti ||
      digest(r.token.access_token) !== ticket.assertionDigest
    )
      throw new TfRenewalError("REFERENCE_SPENT");
    await this.confirm(auth, signal);
    return auth;
  }
  async confirm(
    auth: FamilyWsAuthorization,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      !(await awaitReadOnly(
        this.persistence.transition(
          "confirm",
          auth.selection,
          "",
          "",
          Date.parse(auth.session.expiresAt),
        ),
        signal,
      ))
    )
      throw unavailable();
    if (signal?.aborted) throw unavailable();
  }
}
