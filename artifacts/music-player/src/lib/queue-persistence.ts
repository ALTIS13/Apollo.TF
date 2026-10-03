import type { TrackResult, TrackSource, TrackType } from "@workspace/api-client-react";

const VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TRACKS = 500;
const SOURCE_BY_PREFIX: Record<string, TrackSource> = {
  yt: "youtube", sc: "soundcloud", bc: "bandcamp", dz: "deezer",
};
const TYPES = new Set<TrackType>(["original", "remix", "live", "cover"]);

export interface QueueIdentity {
  readonly accountId: string;
  readonly installationId: string;
}

export interface QueueSnapshot {
  readonly queue: TrackResult[];
  readonly index: number;
  readonly positionSeconds: number;
}

function key(identity: QueueIdentity): string {
  return `apollo_tf_queue_v1:${identity.accountId}:${identity.installationId}`;
}

function safeTrack(value: unknown): TrackResult | null {
  if (typeof value !== "object" || value === null) return null;
  const track = value as Record<string, unknown>;
  if (typeof track.id !== "string" || !/^(yt|sc|bc|dz)_[A-Za-z0-9_-]+$/.test(track.id) || track.id.length > 4096)
    return null;
  const prefix = track.id.slice(0, 2);
  if (
    typeof track.title !== "string" || !track.title.trim() || track.title.length > 500 ||
    typeof track.artist !== "string" || !track.artist.trim() || track.artist.length > 300 ||
    !Number.isInteger(track.duration) || (track.duration as number) < 0 || (track.duration as number) > 86_400 ||
    track.source !== SOURCE_BY_PREFIX[prefix] || !TYPES.has(track.type as TrackType)
  ) return null;
  const thumbnail = track.thumbnailUrl;
  if (thumbnail != null && (
    typeof thumbnail !== "string" || thumbnail.length > 2048 ||
    !/^https?:\/\//.test(thumbnail)
  )) return null;
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    duration: track.duration as number,
    source: track.source as TrackSource,
    type: track.type as TrackType,
    thumbnailUrl: thumbnail ?? null,
    quality: [],
    score: 0,
  };
}

export function writeQueueSnapshot(
  storage: Storage,
  identity: QueueIdentity,
  queue: readonly TrackResult[],
  index: number,
  positionSeconds: number,
  now = Date.now(),
): boolean {
  try {
    if (queue.length === 0) {
      storage.removeItem(key(identity));
      return true;
    }
    if (
      queue.length > MAX_TRACKS || !Number.isInteger(index) || index < -1 || index >= queue.length ||
      !Number.isFinite(positionSeconds) || positionSeconds < 0 || positionSeconds > 86_400
    ) return false;
    const safeQueue = queue.map(safeTrack);
    if (safeQueue.some((track) => track === null)) return false;
    storage.setItem(key(identity), JSON.stringify({
      version: VERSION, savedAt: now, queue: safeQueue, index, positionSeconds,
    }));
    return true;
  } catch {
    return false;
  }
}

export function readQueueSnapshot(
  storage: Storage,
  identity: QueueIdentity,
  now = Date.now(),
): QueueSnapshot | null {
  try {
    const raw = storage.getItem(key(identity));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const snapshot = value as Record<string, unknown>;
    if (
      snapshot.version !== VERSION ||
      typeof snapshot.savedAt !== "number" || !Number.isFinite(snapshot.savedAt) ||
      snapshot.savedAt > now + 60_000 || now - snapshot.savedAt > MAX_AGE_MS ||
      !Array.isArray(snapshot.queue) || snapshot.queue.length === 0 || snapshot.queue.length > MAX_TRACKS ||
      !Number.isInteger(snapshot.index) || (snapshot.index as number) < -1 ||
      (snapshot.index as number) >= snapshot.queue.length ||
      typeof snapshot.positionSeconds !== "number" || !Number.isFinite(snapshot.positionSeconds) ||
      snapshot.positionSeconds < 0 || snapshot.positionSeconds > 86_400
    ) return null;
    const queue = snapshot.queue.map(safeTrack);
    if (queue.some((track) => track === null)) return null;
    return {
      queue: queue as TrackResult[],
      index: snapshot.index as number,
      positionSeconds: snapshot.positionSeconds,
    };
  } catch {
    return null;
  }
}
