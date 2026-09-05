import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import type { StrictRedisClient } from "./tf-session-store.js";
import {
  bindingSchema,
  opaqueSchema,
  renewalResultSchema,
  sameBinding,
  TfRenewalError,
  unavailable,
  type FamilyBinding,
  type RenewalResult,
} from "./tf-renewal-contract.js";

const opaque = () => randomBytes(32).toString("base64url");
const millis = z.number().int().nonnegative().safe();
const operationSchema = z
  .object({
    kind: z.enum(["enroll", "renew"]),
    idempotencyKey: z.string().uuid(),
    correlationId: z.string().uuid(),
    nonce: opaqueSchema,
    attempts: z.number().int().min(0).max(3),
    deadline: millis,
    leaseUntil: millis,
    owner: z.string().uuid().nullable(),
    nextAfter: millis,
  })
  .strict();
const base = {
  version: z.literal(1),
  id: z.string().uuid(),
  createdAt: millis,
  expiresAt: millis,
};
const activeBase = { ...base, csrf: opaqueSchema };
const recordSchema = z.discriminatedUnion("phase", [
  z.object({ ...activeBase, phase: z.literal("LOGIN") }).strict(),
  z
    .object({
      ...activeBase,
      phase: z.literal("ENROLLING"),
      binding: bindingSchema,
      initialAssertion: z.string().min(1).max(8192),
      operation: operationSchema,
    })
    .strict(),
  z
    .object({
      ...activeBase,
      phase: z.literal("ACTIVE"),
      result: renewalResultSchema,
      operation: operationSchema.nullable(),
    })
    .strict(),
  z
    .object({
      ...base,
      phase: z.literal("CLOSED"),
      revocation: z.string().max(24000).nullable(),
    })
    .strict(),
]);
export type FamilyRecord = z.infer<typeof recordSchema>;
export interface FamilyObservation {
  raw: string;
  record: FamilyRecord;
}
export type ClaimedFamily = FamilyObservation & {
  record: Extract<FamilyRecord, { phase: "ENROLLING" | "ACTIVE" }> & {
    operation: z.infer<typeof operationSchema>;
  };
};
export interface FamilyPersistence {
  read(key: string): Promise<string | null>;
  cas(
    key: string,
    expected: string | null,
    value: string,
    expiry: number,
    extend?: boolean,
    outbox?: boolean,
  ): Promise<boolean>;
  pending(): Promise<string[]>;
  allowContext(key: string): Promise<boolean>;
}
const OUTBOX = "tf-auth:{families}:revoke-pending";
const CAS = `
local current = redis.call('GET', KEYS[1])
if (current or '') ~= ARGV[1] then return 0 end
local t = redis.call('TIME')
local now = tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local expiry = tonumber(ARGV[3])
if not expiry or expiry <= now then return 0 end
if current and ARGV[4] ~= '1' then
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl <= 0 then return 0 end
  expiry = math.min(expiry, now+ttl)
end
redis.call('SET', KEYS[1], ARGV[2], 'PXAT', expiry)
if ARGV[5] == '1' then redis.call('ZADD', KEYS[2], expiry, KEYS[1])
else redis.call('ZREM', KEYS[2], KEYS[1]) end
return 1`;
export function redisFamilyPersistence(
  redis: StrictRedisClient,
): FamilyPersistence {
  return {
    read: (key) => redis.get(key),
    async allowContext(key) {
      const result = await redis.eval(
        `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],60000) end; return n`,
        1,
        `${key}:context-rate`,
      );
      if (
        typeof result !== "number" ||
        !Number.isSafeInteger(result) ||
        result < 1
      )
        throw unavailable();
      return result <= 10;
    },
    async cas(key, expected, value, expiry, extend, outbox) {
      const result = await redis.eval(
        CAS,
        2,
        key,
        OUTBOX,
        expected ?? "",
        value,
        expiry,
        extend ? "1" : "0",
        outbox ? "1" : "0",
      );
      if (result !== 0 && result !== 1) throw unavailable();
      return result === 1;
    },
    async pending() {
      const result = await redis.eval(
        `local t=redis.call('TIME')
        redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000))
        return redis.call('ZRANGE',KEYS[1],0,9)`,
        1,
        OUTBOX,
      );
      return z
        .array(z.string().regex(/^tf-auth:\{families\}:[a-f0-9]{64}$/))
        .max(10)
        .parse(result);
    },
  };
}
function key(handle: string) {
  opaqueSchema.parse(handle);
  return `tf-auth:{families}:${createHash("sha256").update(handle).digest("hex")}`;
}
export class TfFamilyStore {
  constructor(
    private readonly persistence: FamilyPersistence,
    private readonly clock: () => number = Date.now,
  ) {}
  now(): number {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0) throw unavailable();
    return value;
  }
  private async readKey(k: string): Promise<FamilyObservation | null> {
    try {
      const raw = await this.persistence.read(k);
      if (raw === null) return null;
      if (raw.length > 40000) throw unavailable();
      const record = recordSchema.parse(JSON.parse(raw));
      const now = this.now();
      if (
        record.createdAt > now ||
        record.expiresAt > record.createdAt + 8 * 3600_000 + 300_000
      )
        throw unavailable();
      if (record.expiresAt <= now) return null;
      return { raw, record };
    } catch {
      throw unavailable();
    }
  }
  read(handle: string) {
    return this.readKey(key(handle));
  }
  async allowContext(handle: string) {
    try {
      if (!(await this.persistence.allowContext(key(handle))))
        throw new TfRenewalError("RATE_LIMITED", 30);
    } catch (error) {
      if (error instanceof TfRenewalError) throw error;
      throw unavailable();
    }
  }
  private async replace(
    k: string,
    previous: string | null,
    record: FamilyRecord,
    extend = false,
  ): Promise<FamilyObservation> {
    const validated = recordSchema.parse(record),
      raw = JSON.stringify(validated);
    let committed: boolean;
    try {
      committed = await this.persistence.cas(
        k,
        previous,
        raw,
        validated.expiresAt,
        extend,
        validated.phase === "CLOSED" && validated.revocation !== null,
      );
    } catch {
      throw unavailable();
    }
    if (!committed) throw new TfRenewalError("REFERENCE_SPENT");
    return { raw, record: validated };
  }
  async createLogin() {
    const now = this.now(),
      handle = opaque();
    const record = {
      version: 1,
      id: randomUUID(),
      csrf: opaque(),
      phase: "LOGIN",
      createdAt: now,
      expiresAt: now + 300_000,
    } as const;
    await this.replace(key(handle), null, record, true);
    return { handle, record };
  }
  private operation(kind: "enroll" | "renew", expiresAt: number) {
    return {
      kind,
      idempotencyKey: randomUUID(),
      correlationId: randomUUID(),
      nonce: opaque(),
      attempts: 0,
      deadline: Math.min(this.now() + 60_000, expiresAt),
      leaseUntil: 0,
      owner: null,
      nextAfter: 0,
    };
  }
  async beginEnrollment(
    handle: string,
    binding: FamilyBinding,
    initialAssertion: string,
  ) {
    const current = await this.read(handle);
    if (!current || current.record.phase !== "LOGIN")
      throw new TfRenewalError("INVALID_REFERENCE");
    await this.replace(key(handle), current.raw, {
      ...current.record,
      phase: "ENROLLING",
      binding,
      initialAssertion,
      operation: this.operation("enroll", current.record.expiresAt),
    });
  }
  async claim(handle: string): Promise<ClaimedFamily> {
    const current = await this.read(handle);
    if (!current || !["ACTIVE", "ENROLLING"].includes(current.record.phase))
      throw new TfRenewalError("INVALID_REFERENCE");
    const record = current.record as ClaimedFamily["record"];
    const now = this.now();
    const operation =
      record.operation ?? this.operation("renew", record.expiresAt);
    if (operation.deadline <= now || operation.attempts >= 3)
      throw new TfRenewalError("RETRY_EXPIRED");
    if (operation.leaseUntil > now || operation.nextAfter > now)
      throw new TfRenewalError(
        "OPERATION_IN_PROGRESS",
        Math.min(
          30,
          Math.max(
            1,
            Math.ceil(
              (Math.max(operation.leaseUntil, operation.nextAfter) - now) /
                1000,
            ),
          ),
        ),
      );
    const next = {
      ...record,
      operation: {
        ...operation,
        attempts: operation.attempts + 1,
        owner: randomUUID(),
        leaseUntil: Math.min(now + 15_000, operation.deadline),
      },
    };
    return (await this.replace(
      key(handle),
      current.raw,
      next,
    )) as ClaimedFamily;
  }
  async complete(
    handle: string,
    claimed: ClaimedFamily,
    result: RenewalResult,
  ) {
    const now = this.now(),
      old = claimed.record;
    if (old.operation.leaseUntil <= now || old.operation.deadline <= now)
      throw new TfRenewalError("OPERATION_UNCERTAIN");
    const parsed = renewalResultSchema.parse(result);
    const binding = old.phase === "ACTIVE" ? old.result : old.binding;
    const absolute = Date.parse(parsed.absolute_expires_at);
    if (
      !sameBinding(binding, parsed) ||
      absolute > now + 8 * 3600_000 ||
      absolute <= now ||
      Date.parse(parsed.access_expires_at) > absolute ||
      Date.parse(parsed.access_expires_at) <= now ||
      parsed.generation !==
        (old.phase === "ACTIVE" ? old.result.generation + 1 : 0) ||
      (old.phase === "ACTIVE" &&
        (parsed.family_id !== old.result.family_id ||
          parsed.absolute_expires_at !== old.result.absolute_expires_at ||
          parsed.renewal_reference === old.result.renewal_reference))
    )
      throw unavailable();
    return this.replace(
      key(handle),
      claimed.raw,
      {
        version: 1,
        id: old.id,
        createdAt: old.createdAt,
        csrf: old.csrf,
        expiresAt:
          old.phase === "ACTIVE" ? Math.min(old.expiresAt, absolute) : absolute,
        phase: "ACTIVE",
        result: parsed,
        operation: null,
      },
      old.phase === "ENROLLING",
    );
  }
  async release(handle: string, claimed: ClaimedFamily, retryAfter = 1) {
    const record = claimed.record;
    try {
      await this.replace(key(handle), claimed.raw, {
        ...record,
        operation: {
          ...record.operation,
          owner: null,
          leaseUntil: 0,
          nextAfter: this.now() + Math.min(30, Math.max(1, retryAfter)) * 1000,
        },
      });
    } catch (error) {
      if (
        !(error instanceof TfRenewalError && error.reason === "REFERENCE_SPENT")
      )
        throw error;
    }
  }
  async close(
    handle: string,
    seal: (record: Extract<FamilyRecord, { phase: "ACTIVE" }>) => string,
    expected?: FamilyObservation,
  ) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.read(handle);
      if (expected && current?.raw !== expected.raw) throw unavailable();
      if (!current || current.record.phase === "CLOSED") return;
      const r = current.record;
      // Create the non-authorizing outbox packet before atomically dropping the reference.
      const revocation = r.phase === "ACTIVE" ? seal(r) : null;
      try {
        await this.replace(key(handle), current.raw, {
          version: 1,
          id: r.id,
          createdAt: r.createdAt,
          expiresAt: r.expiresAt,
          phase: "CLOSED",
          revocation,
        });
        return;
      } catch (error) {
        if (expected) throw unavailable();
        if (
          !(
            error instanceof TfRenewalError &&
            error.reason === "REFERENCE_SPENT"
          )
        )
          throw error;
      }
    }
    throw unavailable();
  }
  async pendingRevocations() {
    const result: {
      key: string;
      observation: FamilyObservation & {
        record: Extract<FamilyRecord, { phase: "CLOSED" }>;
      };
    }[] = [];
    for (const key of await this.persistence.pending()) {
      const observation = await this.readKey(key);
      if (
        observation?.record.phase === "CLOSED" &&
        observation.record.revocation
      )
        result.push({
          key,
          observation: observation as (typeof result)[number]["observation"],
        });
    }
    return result;
  }
  async acknowledgeRevoke(
    key: string,
    observation: FamilyObservation & {
      record: Extract<FamilyRecord, { phase: "CLOSED" }>;
    },
  ) {
    await this.replace(key, observation.raw, {
      ...observation.record,
      revocation: null,
    });
  }
}
