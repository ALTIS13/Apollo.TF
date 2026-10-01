import { z } from "zod";

export const TF_SOURCE_REFERENCE_PATH = "/v1/source-reference";
export const SOURCE_REFERENCE_TTL_MS = 300_000;

const PROVIDER_HOSTS = [
  ["youtube", "youtube.com"], ["youtube", "youtu.be"],
  ["soundcloud", "soundcloud.com"], ["bandcamp", "bandcamp.com"],
  ["deezer", "deezer.com"], ["deezer", "dzcdn.net"],
] as const;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/u;
const TRACKING_PARAMETER = /^(?:utm_.+|si|from|fbclid|gclid)$/iu;

export function canonicalSourceKey(sourceUrl: string): string | undefined {
  if (typeof sourceUrl !== "string") return undefined;
  const input = sourceUrl.trim();
  if (input.length === 0 || input.length > 4_096 || !/^https:\/\//iu.test(input)
    || /[\u0000-\u0020\u007f\\#]/u.test(input)) return undefined;
  let url: URL;
  try { url = new URL(input); } catch { return undefined; }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return undefined;
  const provider = PROVIDER_HOSTS.find(([, host]) => url.hostname === host || url.hostname.endsWith(`.${host}`))?.[0];
  if (!provider) return undefined;

  // Normalize escape spelling without turning reserved bytes into routing delimiters.
  url.pathname = url.pathname.replace(/%[0-9a-f]{2}/giu, (escape) => {
    const character = String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    return /^[A-Za-z0-9._~-]$/u.test(character) ? character : escape.toUpperCase();
  });

  if (provider === "youtube") {
    const path = url.pathname.replace(/\/$/u, "");
    const queryIds = url.searchParams.getAll("v");
    let videoId: string | undefined;
    const shortHost = /^(?:www\.|m\.)?youtu\.be$/u.test(url.hostname);
    const videoHost = /^(?:www\.|m\.|music\.)?youtube\.com$/u.test(url.hostname);
    if (shortHost && path) {
      videoId = path.slice(1);
    } else if (videoHost && path === "/watch" && queryIds.length > 0) {
      videoId = queryIds[0];
    } else if (videoHost && /^\/(?:shorts|embed|live)\//u.test(path)) {
      videoId = path.split("/")[2];
      if (path.split("/").length !== 3) return undefined;
    }
    if (videoId !== undefined) {
      if (!VIDEO_ID.test(videoId) || queryIds.some((id) => id !== videoId)) return undefined;
      return `youtube:${videoId}`;
    }
  }

  if (provider === "soundcloud" && /^(?:www\.|m\.)soundcloud\.com$/u.test(url.hostname)) {
    url.hostname = "soundcloud.com";
  }
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/u, "");
  if (provider === "soundcloud" && /^(?:api|api-v2)\.soundcloud\.com$/u.test(url.hostname)) {
    const numericTrack = /^\/tracks\/([1-9]\d*)$/u.exec(url.pathname)?.[1];
    if (numericTrack !== undefined) {
      const queryIds = [...url.searchParams.getAll("id"), ...url.searchParams.getAll("track_id")];
      if (queryIds.some((id) => id !== numericTrack)) return undefined;
      return `soundcloud:track:${numericTrack}`;
    }
  }
  const publicSoundCloudTrack = provider === "soundcloud" && url.hostname === "soundcloud.com"
    && /^\/[^/]+\/[^/]+$/u.test(url.pathname)
    && !/^\/(?:discover|charts|search|you|stream|sets|tracks|users|playlists)\//u.test(url.pathname);
  const bandcampTrack = provider === "bandcamp" && /^\/track\/[^/]+$/u.test(url.pathname);
  if (publicSoundCloudTrack || bandcampTrack) url.search = "";
  for (const name of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETER.test(name)) url.searchParams.delete(name);
  }
  url.searchParams.sort();
  url.search = url.searchParams.toString();
  const key = `${provider}:${url.href}`;
  return key.length <= 8_192 ? key : undefined;
}

const canonicalUuidSchema = z.string().uuid()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const epochMsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const referenceSchema = z.object({
  artist: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(500),
  type: z.enum(["original", "remix", "live", "cover"]),
  expectedDurationSeconds: z.number().int().min(1).max(86_400),
  provenance: z.enum(["catalog", "preview_catalog", "peer"]),
  observedAt: epochMsSchema,
  expiresAt: epochMsSchema,
}).strict().refine((reference) => reference.expiresAt > reference.observedAt
  && reference.expiresAt - reference.observedAt <= SOURCE_REFERENCE_TTL_MS, {
  message: "Expected a positive reference lifetime of at most five minutes",
});

export const tfSourceReferenceCommandSchema = z.object({
  schemaVersion: z.literal(1),
  requestId: canonicalUuidSchema,
  accountId: canonicalUuidSchema,
  sourceUrl: z.string().trim().min(1).max(4_096).refine((value) => canonicalSourceKey(value) !== undefined),
}).strict();

const responseFields = {
  schemaVersion: z.literal(1),
  requestId: canonicalUuidSchema,
  sourceKey: z.string().min(1).max(8_192),
};
export const tfSourceReferenceResponseSchema = z.discriminatedUnion("status", [
  z.object({ ...responseFields, status: z.literal("known"), reference: referenceSchema }).strict(),
  z.object({ ...responseFields, status: z.literal("unknown") }).strict(),
  z.object({ ...responseFields, status: z.literal("ambiguous") }).strict(),
]);

export type TfSourceReferenceCommand = z.infer<typeof tfSourceReferenceCommandSchema>;
export type TfSourceReferenceResponse = z.infer<typeof tfSourceReferenceResponseSchema>;
export type TfSourceReference = z.infer<typeof referenceSchema>;
