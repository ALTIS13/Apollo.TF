import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type MediaLinkSource = "youtube" | "soundcloud" | "bandcamp" | "deezer";
export type MediaLinkResolutionErrorCode = "unsupported_media_link" | "media_link_unavailable";

export interface MediaLinkResolution {
  readonly schemaVersion: 1;
  readonly source: MediaLinkSource;
  readonly title: string;
  readonly artist?: string;
  readonly durationSeconds?: number;
}

export class MediaLinkResolutionError extends Error {
  constructor(readonly code: MediaLinkResolutionErrorCode) {
    super(code);
    this.name = "MediaLinkResolutionError";
  }
}

export interface MediaLinkYtDlpOptions {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface MediaLinkDependencies {
  readonly fetch?: typeof fetch;
  readonly runYtDlp?: (args: readonly string[], options: MediaLinkYtDlpOptions) => Promise<string>;
}

type ParsedLink =
  | { readonly source: "youtube"; readonly canonicalUrl: string; readonly videoId: string }
  | { readonly source: "soundcloud"; readonly canonicalUrl: string }
  | { readonly source: "bandcamp"; readonly canonicalUrl: string }
  | { readonly source: "deezer"; readonly trackId: string };

const MAX_INPUT_BYTES = 2_048;
const MAX_RESPONSE_BYTES = 64 * 1_024;
const MAX_YTDLP_OUTPUT_BYTES = 256 * 1_024;
const PROVIDER_TIMEOUT_MS = 8_000;
const YTDLP_TIMEOUT_MS = 10_000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const SHARE_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;
const SHARE_TIME = /^(?:\d{1,6}s?|\d{1,3}h(?:\d{1,2}m)?(?:\d{1,2}s)?|\d{1,3}m(?:\d{1,2}s)?)$/;
const SLUG = "[A-Za-z0-9][A-Za-z0-9_-]*";
const SOUNDCLOUD_PATH = new RegExp(`^/(${SLUG})/(${SLUG})$`);
const BANDCAMP_PATH = new RegExp(`^/track/(${SLUG})$`);
const DEEZER_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?track\/([1-9]\d{0,14})$/i;
const RESERVED_SOUNDCLOUD_SEGMENTS = new Set([
  "albums", "charts", "comments", "discover", "followers", "following", "likes",
  "playlists", "reposts", "search", "sets", "stations", "stream", "tracks", "you",
]);
const execFileAsync = promisify(execFile);

function unsupported(): never {
  throw new MediaLinkResolutionError("unsupported_media_link");
}

function unavailable(): never {
  throw new MediaLinkResolutionError("media_link_unavailable");
}

function youtubeShareVideoId(query: string, expectVideoId: boolean): string | undefined {
  const params = new URLSearchParams(query);
  if (query !== "" && params.toString() !== query.slice(1)) unsupported();
  const seen = new Set<string>();
  let videoId: string | undefined;
  for (const [key, value] of params) {
    if (seen.has(key)) unsupported();
    seen.add(key);
    if (key === "v" && expectVideoId && VIDEO_ID.test(value)) {
      videoId = value;
    } else if (key === "si" && SHARE_TOKEN.test(value)) {
      continue;
    } else if (key === "t" && value.length <= 16 && SHARE_TIME.test(value)) {
      continue;
    } else {
      unsupported();
    }
  }
  if (expectVideoId && !videoId) unsupported();
  return videoId;
}

function parsePastedLink(inputUrl: string): ParsedLink {
  if (typeof inputUrl !== "string" || Buffer.byteLength(inputUrl, "utf8") > MAX_INPUT_BYTES) unsupported();
  const value = inputUrl.trim();
  if (
    value === "" ||
    !/^https:\/\//i.test(value) ||
    /[\u0000-\u001f\u007f\\%]/.test(value)
  ) unsupported();

  const raw = /^https:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(value);
  if (!raw) unsupported();
  const authority = raw[1]!;
  if (/[@:%]/.test(authority) || raw[4] !== undefined) unsupported();

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return unsupported();
  }
  const path = raw[2] || "/";
  const query = raw[3] ?? "";
  if (
    url.protocol !== "https:" ||
    url.username !== "" || url.password !== "" || url.port !== "" || url.hash !== "" ||
    authority.toLowerCase() !== url.hostname ||
    path !== url.pathname || query !== url.search
  ) unsupported();

  if (["youtube.com", "www.youtube.com", "music.youtube.com"].includes(url.hostname)) {
    const videoId = path === "/watch"
      ? youtubeShareVideoId(query, true)
      : /^\/shorts\/([A-Za-z0-9_-]{11})$/.exec(path)?.[1];
    if (!videoId) unsupported();
    if (path !== "/watch") youtubeShareVideoId(query, false);
    return { source: "youtube", videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
  }

  if (url.hostname === "youtu.be") {
    const videoId = /^\/([A-Za-z0-9_-]{11})$/.exec(path)?.[1];
    if (!videoId) unsupported();
    youtubeShareVideoId(query, false);
    return { source: "youtube", videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
  }

  if (url.hostname === "soundcloud.com" || url.hostname === "www.soundcloud.com") {
    const match = SOUNDCLOUD_PATH.exec(path);
    if (!match || query !== "" || match[1]!.length > 80 || match[2]!.length > 120 ||
      RESERVED_SOUNDCLOUD_SEGMENTS.has(match[1]!.toLowerCase()) ||
      RESERVED_SOUNDCLOUD_SEGMENTS.has(match[2]!.toLowerCase())) unsupported();
    return { source: "soundcloud", canonicalUrl: `https://soundcloud.com/${match[1]}/${match[2]}` };
  }

  const bandcampHost = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.bandcamp\.com$/.exec(url.hostname);
  if (bandcampHost) {
    const match = BANDCAMP_PATH.exec(path);
    if (!match || query !== "" || match[1]!.length > 120 || bandcampHost[1] === "www") unsupported();
    return { source: "bandcamp", canonicalUrl: `https://${url.hostname}/track/${match[1]}` };
  }

  if (url.hostname === "deezer.com" || url.hostname === "www.deezer.com") {
    const trackId = DEEZER_PATH.exec(path)?.[1];
    if (!trackId || query !== "" || !Number.isSafeInteger(Number(trackId))) unsupported();
    return { source: "deezer", trackId };
  }

  return unsupported();
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) unavailable();
  return value as Record<string, unknown>;
}

function cleanText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") unavailable();
  const text = value.normalize("NFC").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim();
  if (text === "") return undefined;
  if (text.length > maxLength) unavailable();
  return text;
}

function result(
  source: MediaLinkSource,
  metadata: Record<string, unknown>,
  artistValue?: unknown,
): MediaLinkResolution {
  const title = cleanText(metadata.title, 300);
  if (!title) unavailable();
  const artist = cleanText(artistValue, 200);
  const duration = metadata.duration;
  const durationSeconds = typeof duration === "number" && Number.isFinite(duration) &&
    duration > 0 && duration <= 86_400 ? Math.round(duration) : undefined;
  return {
    schemaVersion: 1,
    source,
    title,
    ...(artist === undefined ? {} : { artist }),
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
  };
}

function ytDlpEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { PYTHONIOENCODING: "utf-8" };
  for (const key of ["PATH", "HOME", "XDG_CACHE_HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL"]) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return environment;
}

async function runYtDlp(args: readonly string[], options: MediaLinkYtDlpOptions): Promise<string> {
  const { stdout } = await execFileAsync("yt-dlp", [...args], {
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout: options.timeoutMs,
    maxBuffer: options.maxOutputBytes,
    signal: options.signal,
    env: ytDlpEnvironment(),
  });
  return stdout;
}

async function ytDlpMetadata(
  link: Extract<ParsedLink, { source: "youtube" | "bandcamp" }>,
  dependencies: MediaLinkDependencies,
): Promise<MediaLinkResolution> {
  const args = [
    "--dump-single-json", "--skip-download", "--no-playlist", "--ignore-config",
    "--no-cache-dir", "--no-warnings", "--", link.canonicalUrl,
  ];
  const output = await (dependencies.runYtDlp ?? runYtDlp)(args, {
    signal: AbortSignal.timeout(YTDLP_TIMEOUT_MS),
    timeoutMs: YTDLP_TIMEOUT_MS,
    maxOutputBytes: MAX_YTDLP_OUTPUT_BYTES,
  });
  if (Buffer.byteLength(output, "utf8") > MAX_YTDLP_OUTPUT_BYTES) unavailable();
  const metadata = record(JSON.parse(output) as unknown);
  if (metadata._type === "playlist" || Array.isArray(metadata.entries)) unavailable();
  if (link.source === "youtube") {
    if (metadata.extractor_key !== "Youtube" || metadata.id !== link.videoId ||
      metadata.webpage_url !== link.canonicalUrl) unavailable();
    return result("youtube", metadata, metadata.artist ?? metadata.uploader ?? metadata.channel);
  }
  if (metadata.extractor_key !== "Bandcamp" || metadata.webpage_url !== link.canonicalUrl ||
    typeof metadata.id !== "string" || metadata.id === "") unavailable();
  return result("bandcamp", metadata, metadata.artist ?? metadata.uploader);
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    unavailable();
  }
  if (response.body === null) unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) unavailable();
      chunks.push(value);
    }
  } finally {
    if (size > MAX_RESPONSE_BYTES) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size);
  return record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown);
}

async function fetchMetadata(url: string, dependencies: MediaLinkDependencies): Promise<Record<string, unknown>> {
  const response = await (dependencies.fetch ?? fetch)(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!response.ok || response.redirected || (response.url !== "" && response.url !== url)) {
    await response.body?.cancel().catch(() => undefined);
    unavailable();
  }
  return readBoundedJson(response);
}

function isSoundCloudTrackEmbed(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 8_192) return false;
  const source = /<iframe\b[^>]*\bsrc="([^"]+)"/i.exec(value)?.[1];
  if (!source) return false;
  try {
    const player = new URL(source);
    const media = new URL(player.searchParams.get("url") ?? "");
    return player.protocol === "https:" && player.hostname === "w.soundcloud.com" &&
      player.pathname === "/player/" && media.hostname === "api.soundcloud.com" &&
      /^\/tracks\/[1-9]\d*$/.test(media.pathname);
  } catch {
    return false;
  }
}

async function soundCloudMetadata(
  link: Extract<ParsedLink, { source: "soundcloud" }>,
  dependencies: MediaLinkDependencies,
): Promise<MediaLinkResolution> {
  const endpoint = new URL("https://soundcloud.com/oembed");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("url", link.canonicalUrl);
  const metadata = await fetchMetadata(endpoint.href, dependencies);
  if (metadata.provider_name !== "SoundCloud" || metadata.provider_url !== "https://soundcloud.com" ||
    metadata.type !== "rich" || !isSoundCloudTrackEmbed(metadata.html)) unavailable();
  const title = cleanText(metadata.title, 300);
  const author = cleanText(metadata.author_name, 200);
  if (!title) unavailable();
  const suffix = author ? ` by ${author}` : null;
  const withoutDuplicateAuthor = suffix && title.slice(-suffix.length).toLowerCase() === suffix.toLowerCase()
    ? title.slice(0, -suffix.length).trim()
    : "";
  return result("soundcloud", {
    ...metadata,
    title: withoutDuplicateAuthor || title,
  }, author);
}

async function deezerMetadata(
  link: Extract<ParsedLink, { source: "deezer" }>,
  dependencies: MediaLinkDependencies,
): Promise<MediaLinkResolution> {
  const metadata = await fetchMetadata(`https://api.deezer.com/track/${link.trackId}`, dependencies);
  if (metadata.id !== Number(link.trackId)) unavailable();
  const artist = metadata.artist === undefined ? undefined : record(metadata.artist).name;
  return result("deezer", metadata, artist);
}

export async function resolvePastedMediaLink(
  inputUrl: string,
  dependencies: MediaLinkDependencies = {},
): Promise<MediaLinkResolution> {
  const link = parsePastedLink(inputUrl);
  try {
    if (link.source === "youtube" || link.source === "bandcamp") {
      return await ytDlpMetadata(link, dependencies);
    }
    if (link.source === "soundcloud") return await soundCloudMetadata(link, dependencies);
    return await deezerMetadata(link, dependencies);
  } catch {
    return unavailable();
  }
}
