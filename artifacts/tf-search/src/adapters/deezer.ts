import { z } from "zod";
import { classify } from "../classifier.js";
import type { RecordingDurationReference } from "../recording-reference.js";
import type { InternalTrack } from "../search-service.js";

const MAX_RESULTS = 25;
const CACHE_TTL_MS = 5 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 256;
const MAX_IN_FLIGHT = 16;
const MAX_TITLE_LENGTH = 500;

const thumbnailSchema = z.string().trim().max(4_096).url().refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
});

const trackSchema = z.object({
  id: z.number().int().positive().safe(),
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  title_version: z.string().trim().max(MAX_TITLE_LENGTH).optional(),
  duration: z.number().finite().int().min(1).max(86_400),
  artist: z.object({ name: z.string().trim().min(1).max(300) }),
  preview: z.string().trim().max(4_096).optional().catch(undefined),
  album: z.object({ cover_medium: thumbnailSchema.nullish().catch(null) }).optional().catch(undefined),
  rank: z.number().finite().int().nonnegative().safe().optional().catch(undefined),
});
const responseSchema = z.object({
  data: z.array(z.unknown()),
  error: z.unknown().optional(),
});
type DeezerTrack = z.infer<typeof trackSchema>;

interface CacheEntry {
  readonly expiresAt: number;
  readonly tracks: readonly DeezerTrack[];
}
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<readonly DeezerTrack[]>>();

function encodeTrackId(url: string): string {
  return `dz_${Buffer.from(url).toString("base64url")}`;
}

function versionedTitle(track: DeezerTrack): string {
  const version = track.title_version;
  if (!version) return track.title;
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase()
    .replace(/\s+/gu, " ").trim();
  const versionName = normalize(version.replace(/^\(([^()]*)\)$|^\[([^\[\]]*)\]$/u, "$1$2"));
  // Natural title words are not proof that a recording qualifier was applied.
  const suffix = track.title.match(/^(.*?)(?:\(([^()]*)\)|\[([^\[\]]*)\])$/u)
    ?? track.title.match(/^(.*)\s+-\s+(.+)$/u);
  const qualifier = suffix?.[2] ?? suffix?.[3];
  if (suffix?.[1]?.trim() && qualifier && versionName && normalize(qualifier) === versionName) return track.title;
  return `${track.title} ${version}`;
}

function usablePreview(preview: string | undefined): preview is string {
  if (!preview) return false;
  try {
    const url = new URL(preview);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (url.hostname === "dzcdn.net" || url.hostname.endsWith(".dzcdn.net")) && url.pathname !== "/" &&
      encodeTrackId(preview).length <= 4_096;
  } catch {
    return false;
  }
}

async function fetchCatalog(query: string, limit: number): Promise<readonly DeezerTrack[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    output: "json",
  });
  const response = await fetch(`https://api.deezer.com/search?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error("deezer_search_failed");

  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.error !== undefined) throw new Error("deezer_search_invalid_response");
  const tracks: DeezerTrack[] = [];
  for (const entry of parsed.data.data.slice(0, limit)) {
    const track = trackSchema.safeParse(entry);
    if (track.success && versionedTitle(track.data).length <= MAX_TITLE_LENGTH) tracks.push(track.data);
  }
  return tracks;
}

async function catalogTracks(query: string, maxResults: number): Promise<readonly DeezerTrack[]> {
  const limit = Number.isFinite(maxResults) ? Math.min(MAX_RESULTS, Math.max(0, Math.floor(maxResults))) : 0;
  if (!query.trim() || limit === 0) return [];
  const key = JSON.stringify([query, limit]);
  const now = Date.now();
  for (const [cachedKey, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(cachedKey);
  }
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.tracks;
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  if (inFlight.size >= MAX_IN_FLIGHT) throw new Error("deezer_search_busy");

  const request = fetchCatalog(query, limit).then((tracks) => {
    while (cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      if (oldestKey === undefined) break;
      cache.delete(oldestKey);
    }
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, tracks });
    return tracks;
  }).finally(() => { inFlight.delete(key); });
  inFlight.set(key, request);
  return request;
}

export async function searchDeezerCatalog(query: string, maxResults = 10): Promise<readonly RecordingDurationReference[]> {
  return (await catalogTracks(query, maxResults)).map((entry) => {
    const title = versionedTitle(entry);
    return { artist: entry.artist.name, title, type: classify(title), duration: entry.duration };
  });
}

export async function searchDeezer(query: string, maxResults = 10): Promise<readonly InternalTrack[]> {
  return (await catalogTracks(query, maxResults)).flatMap((entry) => {
    if (!usablePreview(entry.preview)) return [];
    const title = versionedTitle(entry);
    return [{
      id: encodeTrackId(entry.preview),
      title,
      artist: entry.artist.name,
      type: classify(title),
      duration: entry.duration,
      source: "deezer" as const,
      thumbnailUrl: entry.album?.cover_medium ?? null,
      quality: ["128"],
      viewCount: entry.rank ?? null,
      score: 0,
      sourceUrl: entry.preview,
    }];
  });
}
