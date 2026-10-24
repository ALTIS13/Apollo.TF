import { z } from "zod";
import type {
  TfSearchArtistDiscoveryCommand,
  TfSearchArtistDiscoveryResponse,
  TfSearchCommand,
  TfSearchFreeCommand,
  TfSearchResponse,
  TfSearchResult,
  TfSearchSource,
  TfSearchSuggestionsCommand,
  TfSearchSuggestionsResponse,
} from "@workspace/tf-search-contract";
import {
  canonicalSourceKey, tfSourceReferenceCommandSchema, type TfSourceReferenceCommand, type TfSourceReferenceResponse,
} from "@workspace/tf-search-contract/source-reference";
import { BoundedSearchCache, type SearchCacheIdentity } from "./cache.js";
import { assessMediaCompleteness, filterCompleteMedia, type MediaComparisonAssessment } from "./media-completeness.js";
import { rank, type RankQuery } from "./ranker.js";
import { recordingReferenceKey, type RecordingDurationReference } from "./recording-reference.js";
import { SourceReferenceRegistry } from "./source-reference-registry.js";

export type InternalTrack = TfSearchResult;

export interface SearchProvider {
  readonly source: TfSearchSource;
  search(query: string, limit: number): Promise<readonly InternalTrack[]>;
}

export interface SearchService {
  sourceReference?(command: TfSourceReferenceCommand): Promise<TfSourceReferenceResponse>;
  search(command: TfSearchCommand): Promise<TfSearchResponse>;
  freeSearch(command: TfSearchFreeCommand): Promise<TfSearchResponse>;
  discoverArtist(
    command: TfSearchArtistDiscoveryCommand,
  ): Promise<TfSearchArtistDiscoveryResponse>;
  suggestions(command: TfSearchSuggestionsCommand): Promise<TfSearchSuggestionsResponse>;
  telemetry(): {
    readonly requestsPerMinute: number;
    readonly status: "healthy" | "warning" | "degraded";
  };
  parserTelemetry?: () => readonly ParserTelemetrySnapshot[];
}

export interface RuntimeSearchService extends SearchService {
  sourceReference(command: TfSourceReferenceCommand): Promise<TfSourceReferenceResponse>;
  parserTelemetry(): readonly ParserTelemetrySnapshot[];
}

export interface ParserTelemetrySnapshot {
  readonly source: TfSearchSource;
  readonly status: "healthy" | "warning" | "degraded" | "unknown";
  readonly requestsPerMinute: number;
  readonly failuresPerMinute: number;
  readonly previewsRejectedPerMinute: number;
  readonly lastCheckedAt?: string;
}

interface SearchLogger {
  warn(event: {
    readonly source: TfSearchSource;
    readonly errorClass: "provider_failure" | "catalog_reference_failure";
  }): void;
}

interface SearchServiceOptions {
  readonly providers: readonly SearchProvider[];
  readonly catalogLookup?: CatalogDurationLookup;
  readonly sourceMetadataLookup?: SourceMetadataLookup;
  readonly cache?: BoundedSearchCache;
  readonly now?: () => number;
  readonly logger?: SearchLogger;
}

export type CatalogDurationLookup = (
  query: string,
  limit: number,
  options?: { readonly fresh?: boolean; readonly signal?: AbortSignal },
) => Promise<readonly RecordingDurationReference[]>;

export type SourceMetadataLookup = (
  sourceUrl: string,
  options?: { readonly signal?: AbortSignal },
) => Promise<InternalTrack | undefined>;

const sourceObservationSchema = z.object({
  artist: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(500),
  type: z.enum(["original", "remix", "live", "cover"]),
  duration: z.number().finite().int().min(0).max(86_400),
  source: z.enum(["youtube", "soundcloud", "bandcamp", "deezer"]),
  sourceUrl: z.string().max(4_096),
});
const MAX_SOURCE_REVALIDATIONS = 8;
const MAX_SOURCE_COOLDOWNS = 256;
const SOURCE_REVALIDATION_TIMEOUT_MS = 18_000;
const SOURCE_UNKNOWN_COOLDOWN_MS = 15_000;
const SOURCE_FAILURE_COOLDOWN_MS = 2_000;

function sourceReferenceUnavailable(): Error {
  return new Error("Source reference unavailable");
}

const ALL_SOURCES: readonly TfSearchSource[] = ["yt", "sc", "bc", "dz"];
const ROLLING_WINDOW_SECONDS = 60;
const MAX_CATALOG_SEARCH_CACHE_TTL_MS = 5 * 60 * 1_000;
type ProviderStatus = "ok" | "failed" | "skipped";

const RESULT_SOURCE_TO_PROVIDER: Readonly<
  Record<InternalTrack["source"], TfSearchSource>
> = {
  youtube: "yt",
  soundcloud: "sc",
  bandcamp: "bc",
  deezer: "dz",
};

interface ParserRollingTelemetry {
  readonly bucketSeconds: Int32Array;
  readonly requests: Int32Array;
  readonly failures: Int32Array;
  readonly previewsRejected: Int32Array;
  lastCheckedAt?: number;
}

function createParserRollingTelemetry(): ParserRollingTelemetry {
  return {
    bucketSeconds: new Int32Array(ROLLING_WINDOW_SECONDS).fill(-1),
    requests: new Int32Array(ROLLING_WINDOW_SECONDS),
    failures: new Int32Array(ROLLING_WINDOW_SECONDS),
    previewsRejected: new Int32Array(ROLLING_WINDOW_SECONDS),
  };
}

type SearchInput = TfSearchCommand | TfSearchFreeCommand;

function cacheIdentity(command: SearchInput): SearchCacheIdentity {
  const common = {
    accountId: command.accountId,
    mode: command.mode,
    sources: command.sources,
    maxResults: command.maxResults,
  };
  return "query" in command
    ? { ...common, query: command.query }
    : { ...common, artist: command.artist, title: command.title };
}

function isCacheable(command: SearchInput): boolean {
  return command.maxResults <= 20
    && command.sources.length === ALL_SOURCES.length
    && ALL_SOURCES.every((source) => command.sources.includes(source));
}

function providerLimit(source: TfSearchSource, maxResults: number): number {
  return source === "yt" || source === "sc" ? maxResults : Math.ceil(maxResults / 2);
}

function initialProviderStatus(): Record<TfSearchSource, ProviderStatus> {
  return { yt: "skipped", sc: "skipped", bc: "skipped", dz: "skipped" };
}

function medianOriginalDuration(results: readonly InternalTrack[]): number | undefined {
  const durations = results
    .filter((result) => result.type === "original" && result.duration > 0)
    .map((result) => result.duration)
    .sort((left, right) => left - right);
  return durations.length > 0 ? durations[Math.floor(durations.length / 2)] : undefined;
}

export function toPublicSearchResult(result: InternalTrack): Omit<InternalTrack, "sourceUrl"> {
  const { sourceUrl: _, ...publicResult } = result;
  return publicResult;
}

class SearchServiceImpl implements RuntimeSearchService {
  private readonly providers: ReadonlyMap<TfSearchSource, SearchProvider>;
  private readonly cache: BoundedSearchCache;
  private readonly now: () => number;
  private readonly logger?: SearchLogger;
  private readonly catalogLookup?: CatalogDurationLookup;
  private readonly sourceMetadataLookup?: SourceMetadataLookup;
  private readonly sourceReferences: SourceReferenceRegistry;
  private readonly sourceRevalidations = new Map<string, Promise<void>>();
  private readonly sourceCooldowns = new Map<string, { readonly expiresAt: number; readonly failed: boolean }>();
  private readonly requestBuckets = new Int32Array(ROLLING_WINDOW_SECONDS);
  private readonly partialFailureBuckets = new Int32Array(ROLLING_WINDOW_SECONDS);
  private readonly totalFailureBuckets = new Int32Array(ROLLING_WINDOW_SECONDS);
  private readonly bucketSeconds = new Int32Array(ROLLING_WINDOW_SECONDS).fill(-1);
  private readonly parserBuckets = new Map<TfSearchSource, ParserRollingTelemetry>(
    ALL_SOURCES.map((source) => [source, createParserRollingTelemetry()]),
  );

  constructor(options: SearchServiceOptions) {
    this.providers = new Map(options.providers.map((provider) => [provider.source, provider]));
    this.cache = options.cache ?? new BoundedSearchCache();
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
    this.catalogLookup = options.catalogLookup;
    this.sourceMetadataLookup = options.sourceMetadataLookup;
    this.sourceReferences = new SourceReferenceRegistry({ now: this.now });
  }

  async sourceReference(input: TfSourceReferenceCommand): Promise<TfSourceReferenceResponse> {
    const command = tfSourceReferenceCommandSchema.parse(input);
    let reference = this.sourceReferences.lookup(command.sourceUrl);
    if (reference === undefined) throw new Error("Invalid source reference lookup");
    if (reference.status === "unknown" && this.sourceMetadataLookup) {
      const key = reference.sourceKey;
      let pending = this.sourceRevalidations.get(key);
      if (!pending) {
        for (const [cooldownKey, cooldown] of this.sourceCooldowns) {
          if (cooldown.expiresAt <= this.now()) this.sourceCooldowns.delete(cooldownKey);
        }
        const cooldown = this.sourceCooldowns.get(key);
        if (cooldown?.failed) throw sourceReferenceUnavailable();
        if (!cooldown) {
          if (this.sourceRevalidations.size >= MAX_SOURCE_REVALIDATIONS) throw sourceReferenceUnavailable();
          pending = this.refreshSourceReference(command.sourceUrl, key);
          this.sourceRevalidations.set(key, pending);
        }
      }
      if (pending) await pending;
      reference = this.sourceReferences.lookup(command.sourceUrl);
      if (reference === undefined) throw sourceReferenceUnavailable();
    }
    return { schemaVersion: 1, requestId: command.requestId, ...reference };
  }

  private async refreshSourceReference(sourceUrl: string, sourceKey: string): Promise<void> {
    const controller = new AbortController();
    let timer!: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(sourceReferenceUnavailable());
      }, SOURCE_REVALIDATION_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.observeColdSource(sourceUrl, sourceKey, controller.signal), deadline]);
      if (this.sourceReferences.lookup(sourceUrl)?.status === "unknown") {
        this.rememberSourceCooldown(sourceKey, false);
      }
    } catch {
      this.rememberSourceCooldown(sourceKey, true);
      throw sourceReferenceUnavailable();
    } finally {
      clearTimeout(timer);
      controller.abort();
      this.sourceRevalidations.delete(sourceKey);
    }
  }

  private async observeColdSource(sourceUrl: string, sourceKey: string, signal: AbortSignal): Promise<void> {
    const observed = await this.sourceMetadataLookup!(sourceUrl, { signal });
    signal.throwIfAborted();
    if (observed === undefined) return;
    const parsed = sourceObservationSchema.safeParse(observed);
    if (!parsed.success || canonicalSourceKey(parsed.data.sourceUrl) !== sourceKey
      || !sourceKey.startsWith(`${parsed.data.source}:`)) throw sourceReferenceUnavailable();
    const selected = { ...observed, ...parsed.data };
    if (!assessMediaCompleteness(selected).complete) throw sourceReferenceUnavailable();
    if (!this.catalogLookup) return;
    const recordingKey = recordingReferenceKey(parsed.data, parsed.data.source);
    if (recordingKey === undefined) return;
    const [artist, title] = JSON.parse(recordingKey) as readonly [string, string, string];
    const references = await this.catalogLookup(`${artist} ${title}`, 25, { fresh: true, signal });
    signal.throwIfAborted();
    let comparison: MediaComparisonAssessment | undefined;
    filterCompleteMedia([selected], references, (_track, assessment) => { comparison = assessment; });
    // A single source's own reported length is not an independent catalog reference.
    if (comparison?.status === "known" && comparison.reference.provenance !== "catalog") return;
    if (comparison) this.sourceReferences.observe(sourceUrl, comparison);
  }

  private rememberSourceCooldown(sourceKey: string, failed: boolean): void {
    this.sourceCooldowns.delete(sourceKey);
    while (this.sourceCooldowns.size >= MAX_SOURCE_COOLDOWNS) {
      this.sourceCooldowns.delete(this.sourceCooldowns.keys().next().value!);
    }
    this.sourceCooldowns.set(sourceKey, {
      failed, expiresAt: this.now() + (failed ? SOURCE_FAILURE_COOLDOWN_MS : SOURCE_UNKNOWN_COOLDOWN_MS),
    });
  }

  async search(command: TfSearchCommand): Promise<TfSearchResponse> {
    return this.executeSearch(command, `${command.artist} ${command.title}`, {
      artist: command.artist,
      title: command.title,
    });
  }

  async freeSearch(command: TfSearchFreeCommand): Promise<TfSearchResponse> {
    return this.executeSearch(command, command.query, { text: command.query });
  }

  private async executeSearch(
    command: SearchInput,
    query: string,
    rankQuery: RankQuery,
  ): Promise<TfSearchResponse> {
    this.recordRequest();
    const cacheable = isCacheable(command);

    if (cacheable) {
      const cached = this.cache.get(cacheIdentity(command));
      if (cached) {
        if (command.accountId && "artist" in command && cached.length > 0) {
          this.cache.observe(command.accountId, command.artist, command.title);
        }
        return {
          schemaVersion: 1,
          requestId: command.requestId,
          query,
          results: cached.slice(0, command.maxResults),
          cached: true,
          sources: command.sources,
          fallbackAvailable: false,
          providerStatus: initialProviderStatus(),
        };
      }
    }

    const providerStatus = initialProviderStatus();
    const selectedProviders = command.sources.map((source) => ({ source, provider: this.providers.get(source) }));
    const catalogPending = this.lookupCatalog(query, providerLimit("dz", command.maxResults));
    const providersPending = Promise.allSettled(selectedProviders.map(async ({ source, provider }) => {
      if (!provider) throw { source };
      const results = await provider.search(query, providerLimit(source, command.maxResults));
      return { source, results };
    }));
    const [settled, catalog] = await Promise.all([providersPending, catalogPending]);

    const results: InternalTrack[] = [];
    let succeededProviders = 0;
    let failedProviders = 0;
    for (let index = 0; index < settled.length; index += 1) {
      const outcome = settled[index]!;
      const source = selectedProviders[index]!.source;
      if (outcome.status === "fulfilled") {
        providerStatus[source] = "ok";
        succeededProviders += 1;
        results.push(...outcome.value.results);
        this.recordParserAttempt(source, false);
      } else {
        providerStatus[source] = "failed";
        failedProviders += 1;
        this.recordParserAttempt(source, true);
        this.logger?.warn({ source, errorClass: "provider_failure" });
      }
    }

    if (failedProviders > 0 || catalog.failed) this.recordFailure(succeededProviders === 0);

    const completeMedia = filterCompleteMedia(results, catalog.references,
      (track, comparison) => this.sourceReferences.observe(track.sourceUrl, comparison));
    for (const rejection of completeMedia.rejected) {
      this.recordParserRejections(
        RESULT_SOURCE_TO_PROVIDER[rejection.source],
        rejection.count,
      );
    }
    const ranked = rank(completeMedia.accepted, rankQuery, medianOriginalDuration(completeMedia.accepted), {
      mode: command.mode,
      queryText: query,
    }).slice(0, command.maxResults);

    if (command.accountId && "artist" in command && ranked.length > 0) {
      this.cache.observe(command.accountId, command.artist, command.title);
    }

    if (cacheable && failedProviders === 0 && !catalog.failed) {
      this.cache.set(cacheIdentity(command), ranked,
        this.catalogLookup ? MAX_CATALOG_SEARCH_CACHE_TTL_MS : undefined);
    }

    return {
      schemaVersion: 1,
      requestId: command.requestId,
      query,
      results: ranked,
      cached: false,
      sources: command.sources,
      fallbackAvailable: command.mode === "manual" && ranked.length === 0 && command.sources.length < ALL_SOURCES.length,
      providerStatus,
    };
  }

  async discoverArtist(
    command: TfSearchArtistDiscoveryCommand,
  ): Promise<TfSearchArtistDiscoveryResponse> {
    this.recordRequest();
    const providerStatus = initialProviderStatus();
    const selectedProviders = command.sources.map((source) => ({
      source,
      provider: this.providers.get(source),
    }));
    const catalogPending = this.lookupCatalog(command.artist, command.limitPerSource);
    const providersPending = Promise.allSettled(
      selectedProviders.map(async ({ source, provider }) => {
        if (!provider) throw { source };
        const results = await provider.search(
          command.artist,
          command.limitPerSource,
        );
        return { source, results };
      }),
    );
    const [settled, catalog] = await Promise.all([providersPending, catalogPending]);

    const results: InternalTrack[] = [];
    let succeededProviders = 0;
    let failedProviders = 0;
    for (let index = 0; index < settled.length; index += 1) {
      const outcome = settled[index]!;
      const source = selectedProviders[index]!.source;
      if (outcome.status === "fulfilled") {
        providerStatus[source] = "ok";
        succeededProviders += 1;
        results.push(...outcome.value.results.slice(0, command.limitPerSource));
        this.recordParserAttempt(source, false);
      } else {
        providerStatus[source] = "failed";
        failedProviders += 1;
        this.recordParserAttempt(source, true);
        this.logger?.warn({ source, errorClass: "provider_failure" });
      }
    }

    if (failedProviders > 0 || catalog.failed) this.recordFailure(succeededProviders === 0);

    const completeMedia = filterCompleteMedia(results, catalog.references,
      (track, comparison) => this.sourceReferences.observe(track.sourceUrl, comparison));
    for (const rejection of completeMedia.rejected) {
      this.recordParserRejections(
        RESULT_SOURCE_TO_PROVIDER[rejection.source],
        rejection.count,
      );
    }

    return {
      schemaVersion: 1,
      requestId: command.requestId,
      query: command.artist,
      results: completeMedia.accepted.slice(0, 40),
      sources: command.sources,
      providerStatus,
    };
  }

  async suggestions(command: TfSearchSuggestionsCommand): Promise<TfSearchSuggestionsResponse> {
    return {
      schemaVersion: 1,
      requestId: command.requestId,
      suggestions: command.accountId
        ? [...this.cache.suggestions(command.accountId, command.query, command.limit)]
        : [],
    };
  }

  private async lookupCatalog(query: string, limit: number): Promise<{
    readonly references?: readonly RecordingDurationReference[];
    readonly failed: boolean;
  }> {
    if (!this.catalogLookup) return { failed: false };
    try {
      return { references: await this.catalogLookup(query, limit), failed: false };
    } catch {
      this.logger?.warn({ source: "dz", errorClass: "catalog_reference_failure" });
      return { failed: true };
    }
  }

  telemetry(): { readonly requestsPerMinute: number; readonly status: "healthy" | "warning" | "degraded" } {
    const nowSecond = Math.floor(this.now() / 1_000);
    let requestsPerMinute = 0;
    let partialFailures = 0;
    let totalFailures = 0;
    for (let index = 0; index < ROLLING_WINDOW_SECONDS; index += 1) {
      if (this.bucketSeconds[index]! < nowSecond - (ROLLING_WINDOW_SECONDS - 1)
        || this.bucketSeconds[index]! > nowSecond) {
        this.requestBuckets[index] = 0;
        this.partialFailureBuckets[index] = 0;
        this.totalFailureBuckets[index] = 0;
        continue;
      }
      requestsPerMinute += this.requestBuckets[index]!;
      partialFailures += this.partialFailureBuckets[index]!;
      totalFailures += this.totalFailureBuckets[index]!;
    }

    const status = totalFailures >= 3
      ? "degraded"
      : partialFailures + totalFailures > 0
        ? "warning"
        : "healthy";
    return { requestsPerMinute, status };
  }

  parserTelemetry(): readonly ParserTelemetrySnapshot[] {
    const now = this.now();
    const nowSecond = Math.floor(now / 1_000);
    return ALL_SOURCES.map((source) => {
      const telemetry = this.parserBuckets.get(source)!;
      let requestsPerMinute = 0;
      let failuresPerMinute = 0;
      let previewsRejectedPerMinute = 0;
      for (let index = 0; index < ROLLING_WINDOW_SECONDS; index += 1) {
        if (
          telemetry.bucketSeconds[index]! <
            nowSecond - (ROLLING_WINDOW_SECONDS - 1) ||
          telemetry.bucketSeconds[index]! > nowSecond
        ) {
          telemetry.requests[index] = 0;
          telemetry.failures[index] = 0;
          telemetry.previewsRejected[index] = 0;
          continue;
        }
        requestsPerMinute += telemetry.requests[index]!;
        failuresPerMinute += telemetry.failures[index]!;
        previewsRejectedPerMinute += telemetry.previewsRejected[index]!;
      }
      const status =
        requestsPerMinute === 0
          ? "unknown"
          : failuresPerMinute >= 3
            ? "degraded"
            : failuresPerMinute > 0 || previewsRejectedPerMinute > 0
              ? "warning"
              : "healthy";
      return {
        source,
        status,
        requestsPerMinute,
        failuresPerMinute,
        previewsRejectedPerMinute,
        ...(telemetry.lastCheckedAt === undefined
          ? {}
          : { lastCheckedAt: new Date(telemetry.lastCheckedAt).toISOString() }),
      };
    });
  }

  private recordRequest(): void {
    const second = Math.floor(this.now() / 1_000);
    const bucketIndex = this.ensureBucket(second);
    this.requestBuckets[bucketIndex] += 1;
  }

  private recordFailure(total: boolean): void {
    const bucketIndex = this.ensureBucket(Math.floor(this.now() / 1_000));
    if (total) {
      this.totalFailureBuckets[bucketIndex] += 1;
    } else {
      this.partialFailureBuckets[bucketIndex] += 1;
    }
  }

  private recordParserAttempt(source: TfSearchSource, failed: boolean): void {
    const now = this.now();
    const telemetry = this.parserBuckets.get(source)!;
    const bucketIndex = this.ensureParserBucket(
      telemetry,
      Math.floor(now / 1_000),
    );
    telemetry.requests[bucketIndex] += 1;
    if (failed) telemetry.failures[bucketIndex] += 1;
    telemetry.lastCheckedAt = now;
  }

  private recordParserRejections(source: TfSearchSource, count: number): void {
    if (!Number.isSafeInteger(count) || count <= 0) return;
    const telemetry = this.parserBuckets.get(source)!;
    const bucketIndex = this.ensureParserBucket(
      telemetry,
      Math.floor(this.now() / 1_000),
    );
    telemetry.previewsRejected[bucketIndex] += count;
  }

  private ensureParserBucket(
    telemetry: ParserRollingTelemetry,
    second: number,
  ): number {
    const bucketIndex =
      ((second % ROLLING_WINDOW_SECONDS) + ROLLING_WINDOW_SECONDS) %
      ROLLING_WINDOW_SECONDS;
    if (telemetry.bucketSeconds[bucketIndex] !== second) {
      telemetry.bucketSeconds[bucketIndex] = second;
      telemetry.requests[bucketIndex] = 0;
      telemetry.failures[bucketIndex] = 0;
      telemetry.previewsRejected[bucketIndex] = 0;
    }
    return bucketIndex;
  }

  private ensureBucket(second: number): number {
    const bucketIndex = ((second % ROLLING_WINDOW_SECONDS) + ROLLING_WINDOW_SECONDS) % ROLLING_WINDOW_SECONDS;
    if (this.bucketSeconds[bucketIndex] !== second) {
      this.bucketSeconds[bucketIndex] = second;
      this.requestBuckets[bucketIndex] = 0;
      this.partialFailureBuckets[bucketIndex] = 0;
      this.totalFailureBuckets[bucketIndex] = 0;
    }
    return bucketIndex;
  }
}

export function createSearchService(options: SearchServiceOptions): RuntimeSearchService {
  return new SearchServiceImpl(options);
}
