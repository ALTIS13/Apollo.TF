import { randomUUID } from "node:crypto";
import {
  policyIntrospectionResponseSchema,
  type PlatformAssertionClaims,
} from "@workspace/platform-contract";
import { z } from "zod";

export const opaqueSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine((s) => Buffer.from(s, "base64url").toString("base64url") === s);
const uuid = z
  .string()
  .uuid()
  .refine(
    (s) =>
      s === s.toLowerCase() && s !== "00000000-0000-0000-0000-000000000000",
  );
const time = z
  .string()
  .refine(
    (s) => Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s,
  );
const generation = z.number().int().min(0).max(2147483647);
const assertion = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[\x21-\x7e]+$/);
export const renewalVersion = {
  schema_version: 1,
  contract_id: "apollo.tf.session-renewal.v1",
} as const;
const version = {
  schema_version: z.literal(1),
  contract_id: z.literal(renewalVersion.contract_id),
};
export const bindingSchema = z
  .object({
    ...version,
    account_id: uuid,
    session_id: uuid,
    installation_id: uuid,
    client_id: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
    audience: z.literal("apollo-tf"),
  })
  .strict();
export const enrollSchema = bindingSchema
  .extend({ initial_assertion: assertion, nonce: opaqueSchema })
  .strict();
export const renewSchema = bindingSchema
  .extend({
    family_id: uuid,
    generation,
    renewal_reference: opaqueSchema,
    nonce: opaqueSchema,
  })
  .strict();
export const revokeSchema = renewSchema
  .omit({ nonce: true })
  .extend({ reason: z.enum(["USER_LOGOUT", "LOCAL_SESSION_REPLACED"]) })
  .strict();
export const checkSchema = renewSchema
  .omit({ renewal_reference: true, nonce: true })
  .extend({ access_assertion: assertion })
  .strict();
export const renewalResultSchema = bindingSchema
  .extend({
    family_id: uuid,
    generation,
    renewal_reference: opaqueSchema,
    absolute_expires_at: time,
    issued_at: time,
    access_expires_at: time,
    renew_after: time,
    token: z
      .object({
        access_token: assertion,
        token_type: z.literal("Bearer"),
        expires_in: z.number().int().min(1).max(300),
      })
      .strict(),
  })
  .strict();
export type FamilyBinding = z.infer<typeof bindingSchema>;
export type RenewalResult = z.infer<typeof renewalResultSchema>;
export type EnrollRequest = z.infer<typeof enrollSchema>;
export type RenewRequest = z.infer<typeof renewSchema>;
export type RevokeRequest = z.infer<typeof revokeSchema>;
export type CheckRequest = z.infer<typeof checkSchema>;
export interface RenewalOperation {
  idempotencyKey: string;
  correlationId: string;
}

const errors = {
  INVALID_REQUEST: [400, false],
  UNSUPPORTED_VERSION: [400, false],
  INVALID_CLIENT: [401, false],
  INVALID_REFERENCE: [401, false],
  SESSION_REVOKED: [401, false],
  FAMILY_EXPIRED: [401, false],
  REAUTH_REQUIRED: [401, false],
  ACCESS_EXPIRED: [401, false],
  ACCESS_DENIED: [403, false],
  POLICY_CHANGED: [403, false],
  IDEMPOTENCY_CONFLICT: [409, false],
  REFERENCE_SPENT: [409, false],
  RETRY_EXPIRED: [409, false],
  OPERATION_IN_PROGRESS: [409, true],
  RATE_LIMITED: [429, true],
  AUTHORITY_UNAVAILABLE: [503, true],
  OPERATION_UNCERTAIN: [503, true],
} as const;
export type RenewalCode = keyof typeof errors;
export class TfRenewalError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  readonly terminal: boolean;
  constructor(
    readonly reason: RenewalCode,
    readonly retryAfter = 1,
  ) {
    super("TF renewal unavailable");
    this.code = `TF_RENEWAL_${reason}`;
    this.status = [
      "INVALID_CLIENT",
      "INVALID_REQUEST",
      "UNSUPPORTED_VERSION",
    ].includes(reason)
      ? 503
      : errors[reason][0];
    this.retryable = errors[reason][1];
    this.terminal = [
      "INVALID_REFERENCE",
      "SESSION_REVOKED",
      "FAMILY_EXPIRED",
      "REAUTH_REQUIRED",
    ].includes(reason);
  }
}
export const unavailable = () => new TfRenewalError("AUTHORITY_UNAVAILABLE");

/** JSON.parse validates grammar; a structural token pass rejects duplicate decoded object keys. */
export function parseRenewalJson(source: string): unknown {
  const value: unknown = JSON.parse(source);
  const stack: ({ keys: Set<string>; key: boolean } | null)[] = [];
  const tokens = source.match(/"(?:[^"\\]|\\[\s\S])*"|[{}\[\],:]/g) ?? [];
  for (const token of tokens) {
    if (token === "{") stack.push({ keys: new Set(), key: true });
    else if (token === "[") stack.push(null);
    else if (token === "}" || token === "]") stack.pop();
    else if (token === ",") {
      const top = stack.at(-1);
      if (top) top.key = true;
    } else if (token.startsWith('"')) {
      const top = stack.at(-1);
      if (top?.key) {
        const key = JSON.parse(token) as string;
        if (top.keys.has(key)) throw unavailable();
        top.keys.add(key);
        top.key = false;
      }
    }
  }
  return value;
}
export function familyBinding(value: FamilyBinding): FamilyBinding {
  return bindingSchema.parse(
    Object.fromEntries(
      Object.keys(bindingSchema.shape).map((key) => [
        key,
        value[key as keyof FamilyBinding],
      ]),
    ),
  );
}
export function sameBinding(a: FamilyBinding, b: FamilyBinding): boolean {
  return Object.keys(bindingSchema.shape).every(
    (key) => a[key as keyof FamilyBinding] === b[key as keyof FamilyBinding],
  );
}

export interface RenewalTransport {
  clientId: string;
  request(
    path: string,
    body: string,
    headers: Record<string, string>,
  ): Promise<Response>;
  read(response: Response, maxBytes: number): Promise<string>;
  verify(assertion: string, nonce?: string): Promise<PlatformAssertionClaims>;
}
export class TfRenewalClient {
  constructor(private readonly transport: RenewalTransport) {}
  private async call(
    path: string,
    input: FamilyBinding,
    operation?: RenewalOperation,
  ): Promise<unknown> {
    try {
      if (input.client_id !== this.transport.clientId) throw unavailable();
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Request-ID": randomUUID(),
        "X-Audit-Correlation-ID": uuid.parse(
          operation?.correlationId ?? randomUUID(),
        ),
      };
      if (operation)
        headers["Idempotency-Key"] = uuid.parse(operation.idempotencyKey);
      const body = JSON.stringify(input);
      if (Buffer.byteLength(body) > 12 * 1024) throw unavailable();
      const response = await this.transport.request(
        `/v1/tf/session-renewals/${path}`,
        body,
        headers,
      );
      if (
        response.headers.get("x-request-id") !== headers["X-Request-ID"] ||
        response.headers.get("x-audit-correlation-id") !==
          headers["X-Audit-Correlation-ID"] ||
        response.headers.get("cache-control") !== "no-store" ||
        response.headers.get("pragma") !== "no-cache" ||
        response.headers.get("referrer-policy") !== "no-referrer" ||
        response.headers.has("etag") ||
        response.headers.has("set-cookie") ||
        response.headers.has("content-encoding")
      )
        throw unavailable();
      if (
        !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
          response.headers.get("content-type") ?? "",
        )
      )
        throw unavailable();
      const output = parseRenewalJson(
        await this.transport.read(response, 16 * 1024),
      );
      if (response.status !== 200) {
        const error = z
          .object({ ...version, code: z.string(), retryable: z.boolean() })
          .strict()
          .parse(output);
        const reason = error.code.replace(/^TF_RENEWAL_/, "") as RenewalCode;
        const definition = Object.hasOwn(errors, reason)
          ? errors[reason]
          : null;
        const transportInvalid =
          reason === "INVALID_REQUEST" &&
          [405, 413, 415].includes(response.status);
        if (
          !definition ||
          error.code !== `TF_RENEWAL_${reason}` ||
          (!transportInvalid && definition[0] !== response.status) ||
          definition[1] !== error.retryable
        )
          throw unavailable();
        const retry = response.headers.get("retry-after");
        if (retry !== null && !/^(?:[1-9]|[12][0-9]|30)$/.test(retry))
          throw unavailable();
        throw new TfRenewalError(reason, retry === null ? 1 : Number(retry));
      }
      return output;
    } catch (error) {
      if (error instanceof TfRenewalError) throw error;
      throw unavailable();
    }
  }
  private async result(
    value: unknown,
    input: EnrollRequest | RenewRequest,
  ): Promise<RenewalResult> {
    try {
      const result = renewalResultSchema.parse(value);
      const claims = await this.transport.verify(
        result.token.access_token,
        input.nonce,
      );
      const issued = Date.parse(result.issued_at),
        access = Date.parse(result.access_expires_at),
        absolute = Date.parse(result.absolute_expires_at);
      if (
        !sameBinding(result, input) ||
        result.account_id !== claims.sub ||
        result.session_id !== claims.sid ||
        result.installation_id !== claims.installation_id ||
        result.generation !==
          ("generation" in input ? input.generation + 1 : 0) ||
        ("family_id" in input &&
          (result.family_id !== input.family_id ||
            result.renewal_reference === input.renewal_reference)) ||
        issued !== claims.iat * 1000 ||
        access !== claims.exp * 1000 ||
        result.token.expires_in !== claims.exp - claims.iat ||
        access > absolute ||
        absolute > issued + 8 * 3600_000 ||
        access <= Date.now() ||
        Date.parse(result.renew_after) !== Math.max(issued, access - 60_000)
      )
        throw unavailable();
      return result;
    } catch {
      throw unavailable();
    }
  }
  async enroll(input: EnrollRequest, operation: RenewalOperation) {
    const parsed = enrollSchema.parse(input);
    return this.result(await this.call("enroll", parsed, operation), parsed);
  }
  async renew(input: RenewRequest, operation: RenewalOperation) {
    const parsed = renewSchema.parse(input);
    return this.result(await this.call("renew", parsed, operation), parsed);
  }
  async check(input: CheckRequest) {
    try {
      const parsed = checkSchema.parse(input);
      const claims = await this.transport.verify(parsed.access_assertion);
      const output = z
        .object({
          ...version,
          family_id: uuid,
          generation,
          decision: policyIntrospectionResponseSchema,
        })
        .strict()
        .parse(await this.call("check", parsed));
      const d = output.decision;
      if (
        !d.active ||
        output.family_id !== input.family_id ||
        output.generation !== input.generation ||
        d.accountId !== input.account_id ||
        d.sessionId !== input.session_id ||
        d.installationId !== input.installation_id ||
        claims.sub !== input.account_id ||
        claims.sid !== input.session_id ||
        claims.installation_id !== input.installation_id ||
        Date.parse(d.expiresAt) <= Date.now() ||
        Date.parse(d.expiresAt) > claims.exp * 1000 ||
        d.entitlements.some((key) => !claims.entitlements.includes(key))
      )
        throw unavailable();
      return d;
    } catch (error) {
      if (error instanceof TfRenewalError) throw error;
      throw unavailable();
    }
  }
  async revoke(input: RevokeRequest, operation: RenewalOperation) {
    const parsed = revokeSchema.parse(input);
    try {
      const value = z
        .object({
          ...version,
          family_id: uuid,
          state: z.literal("REVOKED"),
          revoked_at: time,
        })
        .strict()
        .parse(await this.call("revoke", parsed, operation));
      if (
        value.family_id !== input.family_id ||
        Date.parse(value.revoked_at) > Date.now() + 5000
      )
        throw unavailable();
    } catch (error) {
      if (error instanceof TfRenewalError) throw error;
      throw unavailable();
    }
  }
}
