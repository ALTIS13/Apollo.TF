import type { TfSearchResultSource } from "@workspace/tf-search-contract";
import type { TfSourceReference } from "@workspace/tf-search-contract/source-reference";
import type { InternalTrack } from "./search-service.js";
import { recordingReferenceKey, type RecordingDurationReference } from "./recording-reference.js";

export type MediaRejectionReason =
  | "provider_preview_url"
  | "title_marker"
  | "duration_outlier";

export type MediaCompletenessAssessment =
  | { readonly complete: true }
  | {
      readonly complete: false;
      readonly reason: MediaRejectionReason;
    };

export interface RejectedMediaSummary {
  readonly source: TfSearchResultSource;
  readonly reason: MediaRejectionReason;
  readonly count: number;
}

export type MediaComparisonAssessment =
  | { readonly status: "known"; readonly recordingKey: string;
      readonly reference: Omit<TfSourceReference, "observedAt" | "expiresAt"> }
  | { readonly status: "unknown" | "ambiguous"; readonly recordingKey?: string };

const TITLE_MARKER_PATTERN =
  /(?<![\p{L}\p{N}])(?:(?:demo|preview|snippet|teaser|sample|демо|превью|отрывок|фрагмент|тизер)|(?:30|45|60)\s*(?:s|sec|secs|second|seconds|сек|секунда|секунды|секунд))(?![\p{L}\p{N}])/iu;
const SOURCE_ORDER: readonly TfSearchResultSource[] = [
  "youtube",
  "soundcloud",
  "bandcamp",
  "deezer",
];
const REASON_ORDER: readonly MediaRejectionReason[] = [
  "provider_preview_url",
  "title_marker",
  "duration_outlier",
];

function isProviderPreviewMedia(track: InternalTrack): boolean {
  if (track.source !== "deezer") return false;
  try {
    const hostname = new URL(track.sourceUrl).hostname;
    // The current Deezer adapter encodes its API's preview field as a CDN URL.
    return hostname === "dzcdn.net" || hostname.endsWith(".dzcdn.net");
  } catch {
    return false;
  }
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function isValidDuration(duration: number): boolean {
  return Number.isInteger(duration) && duration > 0 && duration <= 86_400;
}

function addReference(references: Map<string, RecordingDurationReference[]>, key: string, reference: RecordingDurationReference): void {
  const matching = references.get(key);
  if (matching) matching.push(reference);
  else references.set(key, [reference]);
}

function agreeingDuration(values: readonly number[]): number | undefined {
  // Allow provider rounding, not a median between incompatible recording lengths.
  if (values.length === 0 || Math.max(...values) - Math.min(...values) > 2) return undefined;
  return median(values);
}

export function assessMediaCompleteness(
  track: InternalTrack,
  referenceDuration?: number,
): MediaCompletenessAssessment {
  if (isProviderPreviewMedia(track)) {
    return { complete: false, reason: "provider_preview_url" };
  }
  if (TITLE_MARKER_PATTERN.test(track.title)) {
    return { complete: false, reason: "title_marker" };
  }
  if (
    referenceDuration !== undefined &&
    referenceDuration >= 90 &&
    track.duration > 0 &&
    track.duration <= 90 &&
    track.duration / referenceDuration <= 0.55
  ) {
    return { complete: false, reason: "duration_outlier" };
  }
  return { complete: true };
}

export function filterCompleteMedia(
  tracks: readonly InternalTrack[],
  catalogReferences: readonly RecordingDurationReference[] = [],
  onComparison?: (track: InternalTrack, comparison: MediaComparisonAssessment) => void,
): {
  readonly accepted: InternalTrack[];
  readonly rejected: RejectedMediaSummary[];
} {
  const catalog = new Map<string, RecordingDurationReference[]>();
  const previewCatalog = new Map<string, RecordingDurationReference[]>();
  const peers = new Map<string, RecordingDurationReference[]>();
  for (const reference of catalogReferences) {
    const key = recordingReferenceKey(reference);
    if (key !== undefined && isValidDuration(reference.duration)
      && !TITLE_MARKER_PATTERN.test(reference.title)) {
      addReference(catalog, key, reference);
    }
  }
  const keys = tracks.map((track) => recordingReferenceKey(track, track.source));
  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index]!;
    const key = keys[index];
    if (key === undefined || !isValidDuration(track.duration) || TITLE_MARKER_PATTERN.test(track.title)) continue;
    if (isProviderPreviewMedia(track)) {
      // Preserve legacy catalog-duration fallback, without treating preview URLs as full audio peers.
      addReference(previewCatalog, key, track);
    } else if (track.duration >= 90) {
      addReference(peers, key, track);
    }
  }
  const accepted: InternalTrack[] = [];
  const counts = new Map<string, number>();

  for (let index = 0; index < tracks.length; index += 1) {
    const track = tracks[index]!;
    const key = keys[index];
    const catalogGroup = key === undefined ? undefined : catalog.get(key);
    const previewGroup = key === undefined ? undefined : previewCatalog.get(key);
    const peerGroup = key === undefined ? undefined : peers.get(key);
    // Conflicting catalog metadata stays unknown; peers only fill an absent catalog group.
    const group = catalogGroup ?? previewGroup ?? peerGroup ?? [];
    const referenceDuration = agreeingDuration(group.map((reference) => reference.duration));
    const metadata = group[0];
    const comparison: MediaComparisonAssessment = key !== undefined && metadata && referenceDuration !== undefined
      ? { status: "known", recordingKey: key, reference: {
        artist: metadata.artist, title: metadata.title, type: metadata.type,
        expectedDurationSeconds: Math.round(referenceDuration),
        provenance: catalogGroup ? "catalog" : previewGroup ? "preview_catalog" : "peer",
      } }
      : { status: group.length > 0 ? "ambiguous" : "unknown", ...(key === undefined ? {} : { recordingKey: key }) };
    onComparison?.(track, comparison);
    const assessment = assessMediaCompleteness(track, referenceDuration);
    if (assessment.complete) {
      accepted.push(track);
      continue;
    }
    const rejectionKey = `${track.source}\u0000${assessment.reason}`;
    counts.set(rejectionKey, (counts.get(rejectionKey) ?? 0) + 1);
  }

  const rejected: RejectedMediaSummary[] = [];
  for (const source of SOURCE_ORDER) {
    for (const reason of REASON_ORDER) {
      const count = counts.get(`${source}\u0000${reason}`) ?? 0;
      if (count > 0) rejected.push({ source, reason, count });
    }
  }
  return { accepted, rejected };
}
