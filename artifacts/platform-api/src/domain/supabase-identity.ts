import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Pool, QueryResultRow } from "pg";
import { z } from "zod";

import {
  setAccountContext,
  withPlatformTransaction,
} from "@workspace/platform-db";

import {
  PlatformDomainError,
  invalidCredentialsError,
  platformDomainError,
} from "./errors.js";
import type {
  IdentitySubjectRepository,
  PlatformRepository,
} from "./repository.js";
import type { PlatformTransaction } from "./registration.js";

export const SUPABASE_IDENTITY_PROVIDER = "supabase" as const;

const accessTokenClaimsSchema = z
  .object({
    sub: z.string().uuid(),
    session_id: z.string().uuid(),
    role: z.literal("authenticated"),
    aal: z.enum(["aal1", "aal2"]),
    iat: z.number().int().nonnegative(),
    exp: z.number().int().positive(),
    is_anonymous: z.boolean().optional(),
  })
  .passthrough();

export interface SupabaseAccessTokenVerifierOptions {
  readonly issuer: string;
  readonly audience: "authenticated";
  readonly jwks: JWTVerifyGetKey;
}

export interface SupabaseRemoteVerifierOptions {
  readonly issuer: string;
}

export interface SupabaseSessionClaims {
  readonly providerCode: typeof SUPABASE_IDENTITY_PROVIDER;
  readonly issuer: string;
  readonly subject: string;
  readonly sessionId: string;
  readonly aal: "aal1" | "aal2";
  readonly expiresAt: Date;
}

export class SupabaseAccessTokenVerifier {
  constructor(private readonly options: SupabaseAccessTokenVerifierOptions) {}

  async verify(rawToken: string): Promise<SupabaseSessionClaims> {
    try {
      if (
        typeof rawToken !== "string" ||
        rawToken.length < 1 ||
        rawToken.length > 16_384
      ) {
        throw new Error("invalid token envelope");
      }
      const verified = await jwtVerify(rawToken, this.options.jwks, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ["ES256"],
      });
      const claims = accessTokenClaimsSchema.parse(verified.payload);
      if (claims.is_anonymous === true) {
        throw new Error("anonymous identity is not an Apollo account");
      }
      return Object.freeze({
        providerCode: SUPABASE_IDENTITY_PROVIDER,
        issuer: this.options.issuer,
        subject: claims.sub,
        sessionId: claims.session_id,
        aal: claims.aal,
        expiresAt: new Date(claims.exp * 1_000),
      });
    } catch {
      throw invalidCredentialsError();
    }
  }
}

export function createSupabaseRemoteAccessTokenVerifier(
  options: SupabaseRemoteVerifierOptions,
): SupabaseAccessTokenVerifier {
  let issuer: URL;
  try {
    issuer = new URL(options.issuer);
  } catch {
    throw new Error("Supabase issuer is invalid");
  }
  const loopback =
    issuer.hostname === "127.0.0.1" ||
    issuer.hostname === "localhost" ||
    issuer.hostname === "[::1]";
  if (
    issuer.toString() !== options.issuer ||
    issuer.pathname !== "/auth/v1" ||
    issuer.username.length > 0 ||
    issuer.password.length > 0 ||
    issuer.search.length > 0 ||
    issuer.hash.length > 0 ||
    (issuer.protocol !== "https:" && !(issuer.protocol === "http:" && loopback))
  ) {
    throw new Error("Supabase issuer is invalid");
  }
  const jwks = new URL(`${options.issuer}/.well-known/jwks.json`);
  return new SupabaseAccessTokenVerifier({
    issuer: options.issuer,
    audience: "authenticated",
    jwks: createRemoteJWKSet(jwks, {
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    }),
  });
}

export interface SupabaseSessionLivenessInput {
  readonly subject: string;
  readonly sessionId: string;
}

export interface SupabaseSessionLiveness {
  isLive(input: SupabaseSessionLivenessInput): Promise<boolean>;
}

interface SessionLivenessRow extends QueryResultRow {
  readonly is_live: boolean;
}

export class PostgresSupabaseSessionLiveness implements SupabaseSessionLiveness {
  constructor(private readonly pool: Pool) {}

  async isLive(input: SupabaseSessionLivenessInput): Promise<boolean> {
    const parsed = z
      .object({
        subject: z.string().uuid(),
        sessionId: z.string().uuid(),
      })
      .strict()
      .safeParse(input);
    if (!parsed.success) return false;

    try {
      const result = await this.pool.query<SessionLivenessRow>(
        `select exists (
           select 1
           from auth.sessions
           where id = $1
             and user_id = $2
         ) as is_live`,
        [parsed.data.sessionId, parsed.data.subject],
      );
      return result.rows[0]?.is_live === true;
    } catch {
      return false;
    }
  }
}

export interface SupabaseAccessTokenVerification {
  verify(rawToken: string): Promise<SupabaseSessionClaims>;
}

export interface ApolloIdentityContext {
  readonly accountId: string;
  readonly providerCode: typeof SUPABASE_IDENTITY_PROVIDER;
  readonly issuer: string;
  readonly subject: string;
  readonly sessionId: string;
  readonly aal: "aal1" | "aal2";
  readonly expiresAt: Date;
  readonly identityRevision: number;
}

type ApolloIdentityRepository = IdentitySubjectRepository &
  Pick<PlatformRepository, "lockAccountById">;

export interface SupabaseIdentityServiceOptions {
  readonly pool: Pool;
  readonly repository: ApolloIdentityRepository;
  readonly verifier: SupabaseAccessTokenVerification;
  readonly sessionLiveness: SupabaseSessionLiveness;
  readonly transaction?: PlatformTransaction;
}

export class SupabaseIdentityService {
  private readonly transaction: PlatformTransaction;

  constructor(private readonly options: SupabaseIdentityServiceOptions) {
    this.transaction = options.transaction ?? withPlatformTransaction;
  }

  authenticate(rawToken: string): Promise<ApolloIdentityContext> {
    return this.resolve(rawToken, false);
  }

  authenticateForSensitiveAction(
    rawToken: string,
  ): Promise<ApolloIdentityContext> {
    return this.resolve(rawToken, true);
  }

  private async resolve(
    rawToken: string,
    requireLiveSession: boolean,
  ): Promise<ApolloIdentityContext> {
    let claims: SupabaseSessionClaims;
    try {
      claims = await this.options.verifier.verify(rawToken);
    } catch (error) {
      if (
        error instanceof PlatformDomainError &&
        error.code === "invalid_credentials"
      ) {
        throw error;
      }
      throw invalidCredentialsError();
    }

    if (requireLiveSession) {
      let live = false;
      try {
        live = await this.options.sessionLiveness.isLive({
          subject: claims.subject,
          sessionId: claims.sessionId,
        });
      } catch {
        live = false;
      }
      if (!live) throw invalidCredentialsError();
    }

    try {
      return await this.transaction(this.options.pool, async (client) => {
        const link = await this.options.repository.findAccountByIdentitySubject(
          client,
          {
            providerCode: claims.providerCode,
            identityIssuer: claims.issuer,
            identitySubject: claims.subject,
          },
        );
        if (link === null || link.state !== "active") {
          throw platformDomainError("account_access_denied");
        }
        if (
          link.providerCode !== claims.providerCode ||
          link.identityIssuer !== claims.issuer ||
          link.identitySubject !== claims.subject ||
          link.revokedAt !== null ||
          !Number.isFinite(link.linkedAt.getTime()) ||
          !Number.isFinite(link.lastSeenAt.getTime()) ||
          link.lastSeenAt.getTime() < link.linkedAt.getTime() ||
          !Number.isSafeInteger(link.revision) ||
          link.revision < 1
        ) {
          throw platformDomainError("policy_unavailable");
        }

        await setAccountContext(client, link.accountId);
        const account = await this.options.repository.lockAccountById(
          client,
          link.accountId,
        );
        if (account === null || account.status !== "active") {
          throw platformDomainError("account_access_denied");
        }
        if (account.id !== link.accountId) {
          throw platformDomainError("policy_unavailable");
        }

        return Object.freeze({
          accountId: link.accountId,
          providerCode: claims.providerCode,
          issuer: claims.issuer,
          subject: claims.subject,
          sessionId: claims.sessionId,
          aal: claims.aal,
          expiresAt: claims.expiresAt,
          identityRevision: link.revision,
        });
      });
    } catch (error) {
      if (error instanceof PlatformDomainError) throw error;
      throw platformDomainError("policy_unavailable");
    }
  }
}
