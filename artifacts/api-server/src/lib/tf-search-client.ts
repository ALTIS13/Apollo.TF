import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createSignedBodySignature } from "@workspace/module-runtime-contract";
import {
  TF_SOURCE_REFERENCE_PATH,
  SOURCE_REFERENCE_TTL_MS,
  canonicalSourceKey,
  tfSourceReferenceCommandSchema,
  tfSourceReferenceResponseSchema,
  type TfSourceReferenceCommand,
  type TfSourceReferenceResponse,
} from "@workspace/tf-search-contract/source-reference";
import {
  TF_SEARCH_ARTIST_DISCOVERY_PATH,
  TF_SEARCH_COMMAND_PATH,
  TF_SEARCH_FREE_COMMAND_PATH,
  TF_SEARCH_SUGGESTIONS_PATH,
  tfSearchArtistDiscoveryCommandSchema,
  tfSearchArtistDiscoveryResponseSchema,
  tfSearchCommandSchema,
  tfSearchFreeCommandSchema,
  tfSearchResponseSchema,
  tfSearchSuggestionsCommandSchema,
  tfSearchSuggestionsResponseSchema,
  type TfSearchArtistDiscoveryCommand,
  type TfSearchArtistDiscoveryResponse,
  type TfSearchCommand,
  type TfSearchFreeCommand,
  type TfSearchResponse,
  type TfSearchSuggestionsResponse,
} from "@workspace/tf-search-contract";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_SOURCE_REFERENCE_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const privateServiceNamePattern =
  /^[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

type SecretReader = (path: string) => Promise<string>;

export interface TfSearchClientConfig {
  readonly origin: string;
  readonly internalAuthSecret: string;
  readonly timeoutMs: number;
  readonly sourceReferenceTimeoutMs?: number;
}

export interface ClientDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly randomUuid?: () => string;
  readonly randomNonce?: () => string;
}

interface RequestOptions {
  readonly signal?: AbortSignal;
}

export interface TfSearchGateway {
  sourceReference?(
    input: Omit<TfSourceReferenceCommand, "schemaVersion" | "requestId">,
    options?: RequestOptions,
  ): Promise<TfSourceReferenceResponse>;
  search(
    input: Omit<TfSearchCommand, "schemaVersion" | "requestId">,
    options?: RequestOptions,
  ): Promise<TfSearchResponse>;
  freeSearch(
    input: Omit<TfSearchFreeCommand, "schemaVersion" | "requestId">,
  ): Promise<TfSearchResponse>;
  discoverArtist(
    input: Omit<
      TfSearchArtistDiscoveryCommand,
      "schemaVersion" | "requestId"
    >,
  ): Promise<TfSearchArtistDiscoveryResponse>;
  suggestions(
    accountId: string,
    query: string,
    limit: number,
  ): Promise<TfSearchSuggestionsResponse>;
}

export class TfSearchUnavailableError extends Error {
  readonly code = "search_unavailable";

  constructor() {
    super("TF search unavailable");
    this.name = "TfSearchUnavailableError";
  }
}

function invalidConfiguration(): never {
  throw new Error("invalid runtime configuration");
}

function requiredValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  return value === undefined || value.length === 0
    ? invalidConfiguration()
    : value;
}

function isPrivateServiceHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    privateServiceNamePattern.test(hostname)
  );
}

function parseExactOrigin(value: string, allowInsecureHttp: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidConfiguration();
  }
  if (
    value !== parsed.origin ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return invalidConfiguration();
  }
  if (parsed.protocol === "https:") return parsed.origin;
  if (
    parsed.protocol === "http:" &&
    allowInsecureHttp &&
    isPrivateServiceHostname(parsed.hostname)
  ) {
    return parsed.origin;
  }
  return invalidConfiguration();
}

async function loadSecret(
  env: NodeJS.ProcessEnv,
  readSecret: SecretReader,
): Promise<string> {
  const path = requiredValue(env, "TF_SEARCH_INTERNAL_AUTH_SECRET_FILE");
  try {
    const secret = (await readSecret(path)).trim();
    if (secret.length < 32 || secret.length > 512) {
      return invalidConfiguration();
    }
    return secret;
  } catch {
    return invalidConfiguration();
  }
}

export async function parseTfSearchClientConfig(
  env: NodeJS.ProcessEnv,
  readSecret: SecretReader = (path) => readFile(path, "utf8"),
): Promise<TfSearchClientConfig> {
  const origin = parseExactOrigin(
    requiredValue(env, "TF_SEARCH_ORIGIN"),
    env["TF_SEARCH_ALLOW_INSECURE_HTTP"] === "true",
  );
  const internalAuthSecret = await loadSecret(env, readSecret);
  return {
    origin,
    internalAuthSecret,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

function waitForCancellation<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new TfSearchUnavailableError());
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    // Observe late rejection even when an abort-ignoring dependency outlives this wait.
    work.then((value) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new TfSearchUnavailableError());
      else resolve(value);
    }, (error: unknown) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

async function readBoundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > MAX_RESPONSE_BYTES)
  ) {
    throw new TfSearchUnavailableError();
  }
  if (response.body === null) throw new TfSearchUnavailableError();

  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) {
      cancel();
      throw new TfSearchUnavailableError();
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new TfSearchUnavailableError();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        cancel();
        throw new TfSearchUnavailableError();
      }
      chunks.push(value);
    }

    const raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new TfSearchUnavailableError();
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function boundedTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new Error("invalid TF search client configuration");
  }
  return value;
}

export class HttpTfSearchClient implements TfSearchGateway {
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;
  private readonly randomUuid: () => string;
  private readonly randomNonce: () => string;
  private readonly timeoutMs: number;
  private readonly sourceReferenceTimeoutMs: number;

  constructor(
    private readonly config: TfSearchClientConfig,
    dependencies: ClientDependencies = {},
  ) {
    this.timeoutMs = boundedTimeout(config.timeoutMs);
    this.sourceReferenceTimeoutMs = boundedTimeout(
      config.sourceReferenceTimeoutMs === undefined ? DEFAULT_SOURCE_REFERENCE_TIMEOUT_MS : config.sourceReferenceTimeoutMs,
    );
    this.fetchImplementation = dependencies.fetch ?? fetch;
    this.now = dependencies.now ?? Date.now;
    this.randomUuid = dependencies.randomUuid ?? randomUUID;
    this.randomNonce =
      dependencies.randomNonce ??
      (() => randomBytes(32).toString("base64url"));
  }

  async sourceReference(
    input: Omit<TfSourceReferenceCommand, "schemaVersion" | "requestId">,
    options: RequestOptions = {},
  ): Promise<TfSourceReferenceResponse> {
    const expectedSourceKey = canonicalSourceKey(input.sourceUrl);
    if (expectedSourceKey === undefined) throw new TfSearchUnavailableError();
    const response = await this.dispatch(
      TF_SOURCE_REFERENCE_PATH,
      { ...input, schemaVersion: 1, requestId: this.randomUuid() },
      tfSourceReferenceCommandSchema,
      tfSourceReferenceResponseSchema,
      options.signal,
    );
    if (response.sourceKey !== expectedSourceKey) throw new TfSearchUnavailableError();
    if (response.status === "known") {
      const { observedAt, expiresAt } = response.reference;
      const now = this.now();
      const lifetime = expiresAt - observedAt;
      if (observedAt > now || expiresAt <= now || lifetime <= 0 || lifetime > SOURCE_REFERENCE_TTL_MS) {
        throw new TfSearchUnavailableError();
      }
    }
    if (options.signal?.aborted) throw new TfSearchUnavailableError();
    return response;
  }

  search(
    input: Omit<TfSearchCommand, "schemaVersion" | "requestId">,
    options: RequestOptions = {},
  ): Promise<TfSearchResponse> {
    return this.dispatch(
      TF_SEARCH_COMMAND_PATH,
      {
        schemaVersion: 1,
        requestId: this.randomUuid(),
        ...input,
      },
      tfSearchCommandSchema,
      tfSearchResponseSchema,
      options.signal,
    );
  }

  freeSearch(
    input: Omit<TfSearchFreeCommand, "schemaVersion" | "requestId">,
  ): Promise<TfSearchResponse> {
    return this.dispatch(
      TF_SEARCH_FREE_COMMAND_PATH,
      { schemaVersion: 1, requestId: this.randomUuid(), ...input },
      tfSearchFreeCommandSchema,
      tfSearchResponseSchema,
    );
  }

  suggestions(
    accountId: string,
    query: string,
    limit: number,
  ): Promise<TfSearchSuggestionsResponse> {
    return this.dispatch(
      TF_SEARCH_SUGGESTIONS_PATH,
      {
        schemaVersion: 1,
        requestId: this.randomUuid(),
        accountId,
        query,
        limit,
      },
      tfSearchSuggestionsCommandSchema,
      tfSearchSuggestionsResponseSchema,
    );
  }

  discoverArtist(
    input: Omit<
      TfSearchArtistDiscoveryCommand,
      "schemaVersion" | "requestId"
    >,
  ): Promise<TfSearchArtistDiscoveryResponse> {
    return this.dispatch(
      TF_SEARCH_ARTIST_DISCOVERY_PATH,
      {
        schemaVersion: 1,
        requestId: this.randomUuid(),
        ...input,
      },
      tfSearchArtistDiscoveryCommandSchema,
      tfSearchArtistDiscoveryResponseSchema,
    );
  }

  private async dispatch<
    TCommand extends { readonly requestId: string },
    TResponse extends { readonly requestId: string },
  >(
    path: string,
    candidate: unknown,
    commandSchema: { parse(value: unknown): TCommand },
    responseSchema: { safeParse(value: unknown): { success: boolean; data?: TResponse } },
    signal?: AbortSignal,
  ): Promise<TResponse> {
    try {
      if (signal?.aborted) throw new TfSearchUnavailableError();
      const command = commandSchema.parse(candidate);
      const rawBody = Buffer.from(JSON.stringify(command), "utf8");
      const timestamp = String(Math.floor(this.now() / 1_000));
      const nonce = this.randomNonce();
      const signature = createSignedBodySignature({
        method: "POST",
        path,
        timestamp,
        nonce,
        rawBody,
        secret: this.config.internalAuthSecret,
      });
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(
        () => controller.abort(),
        path === TF_SOURCE_REFERENCE_PATH ? this.sourceReferenceTimeoutMs : this.timeoutMs,
      );
      try {
        if (signal?.aborted) controller.abort();
        const work = (async () => {
          if (controller.signal.aborted) throw new TfSearchUnavailableError();
          const response = await this.fetchImplementation(
            new URL(path, this.config.origin),
            {
              method: "POST",
              redirect: "error",
              signal: controller.signal,
              headers: {
                "content-type": "application/json",
                "x-apollo-internal-timestamp": timestamp,
                "x-apollo-internal-nonce": nonce,
                "x-apollo-internal-signature": signature,
              },
              body: rawBody.toString("utf8"),
            },
          );
          if (controller.signal.aborted) {
            void response.body?.cancel().catch(() => {});
            throw new TfSearchUnavailableError();
          }
          if (response.status !== 200) throw new TfSearchUnavailableError();
          const parsed = responseSchema.safeParse(
            await readBoundedJson(response, controller.signal),
          );
          if (
            controller.signal.aborted ||
            !parsed.success ||
            parsed.data === undefined ||
            parsed.data.requestId !== command.requestId
          ) {
            throw new TfSearchUnavailableError();
          }
          return parsed.data;
        })();
        return await waitForCancellation(work, controller.signal);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
    } catch (error) {
      if (error instanceof TfSearchUnavailableError) throw error;
      throw new TfSearchUnavailableError();
    }
  }
}
