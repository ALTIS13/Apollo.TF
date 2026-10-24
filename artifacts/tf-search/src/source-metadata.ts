import { spawn, type ChildProcess } from "node:child_process";
import { canonicalSourceKey } from "@workspace/tf-search-contract/source-reference";
import { z } from "zod";
import { classify } from "./classifier.js";
import { assessMediaCompleteness } from "./media-completeness.js";
import type { InternalTrack } from "./search-service.js";
import { createYtDlpEnvironment } from "./ytdlp-search.js";

const INSPECTION_TIMEOUT_MS = 8_000;
const MAX_STDOUT_BYTES = 1024 * 1024;
const metadataSchema = z.object({
  _type: z.literal("video").optional(),
  entries: z.never().optional(),
  title: z.string().trim().min(1).max(500).optional(),
  artist: z.string().trim().min(1).max(300).optional(),
  uploader: z.string().trim().min(1).max(300).optional(),
  duration: z.number().finite().min(0).max(86_400).optional(),
  webpage_url: z.string().trim().min(1).max(4_096),
  is_live: z.literal(false).optional(),
  was_live: z.literal(false).optional(),
  live_status: z.literal("not_live").optional(),
});

export class SourceMetadataError extends Error {
  constructor(readonly kind: "invalid_source" | "invalid_metadata" | "process" | "timeout" | "output_limit" | "aborted") {
    super(`source_metadata_${kind}`);
    this.name = "SourceMetadataError";
  }
}

interface Selection {
  readonly source: "youtube" | "soundcloud" | "bandcamp";
  readonly prefix: "yt" | "sc" | "bc";
  readonly extractor: string;
}

function selectSource(sourceKey: string): Selection | undefined {
  if (/^youtube:[A-Za-z0-9_-]{11}$/u.test(sourceKey)) {
    return { source: "youtube", prefix: "yt", extractor: "^youtube$" };
  }
  if (sourceKey.startsWith("soundcloud:https://")) {
    const url = new URL(sourceKey.slice("soundcloud:".length));
    if (url.hostname === "soundcloud.com" && /^\/[^/]+\/[^/]+$/u.test(url.pathname)
      && !/^\/(?:discover|charts|search|you|stream|sets|tracks|users|playlists)\//u.test(url.pathname)) {
      return { source: "soundcloud", prefix: "sc", extractor: "^soundcloud$" };
    }
  }
  if (sourceKey.startsWith("bandcamp:https://")
    && /^\/track\/[^/]+$/u.test(new URL(sourceKey.slice("bandcamp:".length)).pathname)) {
    return { source: "bandcamp", prefix: "bc", extractor: "^bandcamp$" };
  }
  return undefined;
}

function extract(sourceUrl: string, extractor: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    let child: ChildProcess | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => stop("aborted");

    function finish(error?: SourceMetadataError): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(Buffer.concat(chunks).toString("utf-8"));
      chunks.length = 0;
    }

    function stop(kind: SourceMetadataError["kind"]): void {
      if (settled) return;
      finish(new SourceMetadataError(kind));
      try { child?.kill("SIGKILL"); } catch { /* Keep the sanitized terminal result. */ }
    }

    if (signal?.aborted) { finish(new SourceMetadataError("aborted")); return; }
    try {
      child = spawn("yt-dlp", [
        "--ignore-config", "--no-plugin-dirs", "--simulate", "--dump-single-json", "--no-playlist",
        "--no-cache-dir", "--no-warnings", "--retries", "0", "--extractor-retries", "0",
        "--socket-timeout", "5", "--use-extractors", extractor, "--", sourceUrl,
      ], { env: createYtDlpEnvironment(), shell: false, stdio: ["ignore", "pipe", "pipe"] });
    } catch { finish(new SourceMetadataError("process")); return; }

    timer = setTimeout(() => stop("timeout"), INSPECTION_TIMEOUT_MS);
    child.stdout!.on("data", (chunk: Buffer) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > MAX_STDOUT_BYTES) { stop("output_limit"); return; }
      chunks.push(chunk);
    });
    child.stderr!.resume();
    child.on("error", () => stop("process"));
    child.on("close", (code) => finish(code === 0 ? undefined : new SourceMetadataError("process")));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export async function inspectSourceMetadata(
  sourceUrl: string,
  options: { readonly signal?: AbortSignal } = {},
): Promise<InternalTrack | undefined> {
  const sourceKey = canonicalSourceKey(sourceUrl);
  if (sourceKey === undefined) throw new SourceMetadataError("invalid_source");
  const selection = selectSource(sourceKey);
  if (!selection) return undefined;
  const selectedUrl = sourceUrl.trim();
  const output = await extract(selectedUrl, selection.extractor, options.signal);
  if (options.signal?.aborted) throw new SourceMetadataError("aborted");
  let raw: unknown;
  try { raw = JSON.parse(output); } catch { throw new SourceMetadataError("invalid_metadata"); }
  // yt-dlp preserves optional Python None values as JSON null.
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const entry = raw as Record<string, unknown>;
    for (const field of ["title", "artist", "uploader", "duration", "is_live", "was_live", "live_status"]) {
      if (entry[field] === null) delete entry[field];
    }
  }
  const parsed = metadataSchema.safeParse(raw);
  if (!parsed.success || canonicalSourceKey(parsed.data.webpage_url) !== sourceKey) {
    throw new SourceMetadataError("invalid_metadata");
  }
  const entry = parsed.data;
  const artist = entry.artist ?? entry.uploader;
  if (!entry.title) return undefined;
  const id = `${selection.prefix}_${Buffer.from(selectedUrl).toString("base64url")}`;
  // The fallback is only for quality assessment; unidentified tracks are not returned.
  const track: InternalTrack = {
    id,
    title: entry.title, artist: artist ?? "Unknown", type: classify(entry.title), duration: Math.round(entry.duration ?? 0),
    source: selection.source, sourceUrl: selectedUrl, thumbnailUrl: null, viewCount: null,
    quality: ["unknown"], score: 0,
  };
  if (!assessMediaCompleteness(track).complete) throw new SourceMetadataError("invalid_metadata");
  if (!artist) return undefined;
  if (id.length > 4_096) throw new SourceMetadataError("invalid_metadata");
  return track;
}
