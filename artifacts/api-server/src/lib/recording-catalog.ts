import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { z } from "zod";

import type { RecordingMediaBinding } from "./recording-media.js";

export interface RecordingCatalogCandidate {
  readonly id: string;
  readonly evidenceRevision: string;
  readonly artist: string;
  readonly title: string;
  readonly edition: "original" | "clean_edit" | "alternate" | "unknown";
  readonly releaseDate: string | null;
  readonly expectedDurationSeconds: number | null;
  readonly measuredDurationSeconds: number | null;
  readonly access: "full" | "preview" | "blocked" | "unverified";
  readonly download: "permitted" | "not_permitted" | "unverified";
  readonly sourceLabel: string;
  readonly sourceUrl: string | null;
  readonly mediaBound?: true;
}

type CatalogEntry = {
  readonly artist: string;
  readonly title: string;
  readonly durationSeconds: number | null;
};

export interface RecordingCatalog {
  candidates(entry: CatalogEntry): Promise<{
    status: "ready" | "unconfigured";
    candidates: RecordingCatalogCandidate[];
  }>;
  mediaBinding?(
    entry: CatalogEntry,
    selection: {
      readonly candidateId: string;
      readonly evidenceRevision: string;
    },
    operation: "audio" | "file",
  ): Promise<
    | { status: "ready"; binding: RecordingMediaBinding }
    | { status: "stale" | "not_permitted" | "unconfigured" }
  >;
}

export class RecordingCatalogError extends Error {
  constructor() {
    super("Recording catalog unavailable");
    this.name = "RecordingCatalogError";
  }
}

const MAX_FILE_BYTES = 512 * 1024;
const MAX_ENTRIES = 512;
const MAX_CANDIDATES = 12;
const MAX_DURATION_SECONDS = 86_400;
const EDITION_ORDER = {
  original: 0,
  clean_edit: 1,
  alternate: 2,
  unknown: 3,
} as const;

const text = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine(
      (value) => !/[\u0000-\u001f\u007f-\u009f\uD800-\uDFFF]/u.test(value),
    );

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isHttpsSourceUrl(value: string): boolean {
  if (
    !/^https:\/\/[^/\\?#]/.test(value) ||
    /[\s\\\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(value)
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname !== "" &&
      url.username === "" &&
      url.password === "" &&
      !value.slice(8).split(/[/?#]/, 1)[0]!.includes("@")
    );
  } catch {
    return false;
  }
}

const date = z.string().refine(isCalendarDate);
const duration = z.number().int().min(1).max(MAX_DURATION_SECONDS).nullable();
const permission = z.enum(["permitted", "not_permitted", "unverified"]);
const evidence = z
  .object({
    recordId: text(128),
    basis: text(500),
    observedDate: date.refine(
      (value) => value <= new Date().toISOString().slice(0, 10),
    ),
    reviewed: z.boolean(),
  })
  .strict();

const recording = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
    artist: text(300),
    title: text(500),
    matchTitle: text(500),
    edition: z.enum(["original", "clean_edit", "alternate", "unknown"]),
    releaseDate: date.nullable(),
    expectedDurationSeconds: duration,
    measuredDurationSeconds: duration,
    mediaKind: z.enum(["full", "preview", "unknown"]),
    streamPermission: permission,
    downloadPermission: permission,
    evidence: evidence.nullable(),
    sourceLabel: text(160),
    sourceUrl: z.string().max(4_096).refine(isHttpsSourceUrl).nullable(),
    media: z
      .object({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        format: z.enum(["wav", "mp3", "ogg", "flac", "m4a"]),
      })
      .strict()
      .optional(),
  })
  .strict();

const manifest = z
  .object({
    schemaVersion: z.literal(1),
    entries: z.array(recording).max(MAX_ENTRIES),
  })
  .strict()
  .refine(
    ({ entries }) =>
      new Set(entries.map(({ id }) => id)).size === entries.length,
  );

type Recording = z.infer<typeof recording>;
type Manifest = z.infer<typeof manifest>;

function isLocalPath(path: string): boolean {
  if (
    path.length > 1_024 ||
    path.trim() !== path ||
    path.includes("\0") ||
    !isAbsolute(path)
  ) {
    return false;
  }
  // Windows UNC/device paths can trigger remote access even through filesystem APIs.
  return process.platform === "win32"
    ? /^[a-z]:[\\/]/i.test(path)
    : !path.startsWith("//");
}

function boundedFile(stat: BigIntStats): boolean {
  return stat.isFile() && stat.size > 0n && stat.size <= BigInt(MAX_FILE_BYTES);
}

function sameFileVersion(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function readManifest(path: string): Promise<Manifest | null> {
  const initial = await lstat(path, { bigint: true });
  if (!boundedFile(initial)) return null;

  const handle = await open(
    path,
    constants.O_RDONLY |
      (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0),
  );
  try {
    const before = await handle.stat({ bigint: true });
    if (!boundedFile(before) || !sameFileVersion(initial, before)) return null;

    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (BigInt(length) !== before.size || !sameFileVersion(before, after))
      return null;

    const content = bytes.subarray(0, length);
    const parsed = manifest.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content)),
    );
    return parsed.success ? parsed.data : null;
  } finally {
    await handle.close();
  }
}

function normalizedMatch(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase().normalize("NFC");
}

function matchesEntry(entry: CatalogEntry): (record: Recording) => boolean {
  const artist = normalizedMatch(entry.artist);
  const title = normalizedMatch(entry.title);
  return (record) =>
    normalizedMatch(record.artist) === artist &&
    normalizedMatch(record.matchTitle) === title;
}

function recordingAccess(
  record: Recording,
): RecordingCatalogCandidate["access"] {
  if (record.streamPermission === "not_permitted") return "blocked";
  if (
    record.streamPermission !== "permitted" ||
    record.evidence?.reviewed !== true
  )
    return "unverified";
  if (record.mediaKind === "preview") return "preview";

  const {
    expectedDurationSeconds: expected,
    measuredDurationSeconds: measured,
  } = record;
  if (expected === null || measured === null) return "unverified";
  if (expected >= 60 && measured * 2 <= expected) return "preview";
  if (record.mediaKind !== "full") return "unverified";

  // Allow whole-second rounding, but never more than five seconds of drift.
  const tolerance = Math.max(1, Math.min(5, Math.floor(expected * 0.02)));
  return Math.abs(expected - measured) <= tolerance ? "full" : "unverified";
}

function evidenceRevision(record: Recording): string {
  // The schema reconstructs keys in a fixed order before hashing the record.
  return createHash("sha256")
    .update("tf-recording-catalog-v1\0")
    .update(JSON.stringify(record))
    .digest("hex");
}

function candidate(record: Recording): RecordingCatalogCandidate {
  const access = recordingAccess(record);
  const download =
    access === "blocked" ||
    access === "preview" ||
    record.downloadPermission === "not_permitted"
      ? "not_permitted"
      : access === "full"
        ? record.downloadPermission
        : "unverified";

  return {
    id: record.id,
    evidenceRevision: evidenceRevision(record),
    artist: record.artist,
    title: record.title,
    edition: record.edition,
    releaseDate: record.releaseDate,
    expectedDurationSeconds: record.expectedDurationSeconds,
    measuredDurationSeconds: record.measuredDurationSeconds,
    access,
    download,
    sourceLabel: record.sourceLabel,
    sourceUrl: record.sourceUrl,
    ...(access === "full" && record.media !== undefined
      ? { mediaBound: true }
      : {}),
  };
}

function compareCandidates(
  left: RecordingCatalogCandidate,
  right: RecordingCatalogCandidate,
): number {
  return (
    Number(right.access === "full") - Number(left.access === "full") ||
    EDITION_ORDER[left.edition] - EDITION_ORDER[right.edition] ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

async function currentManifest(): Promise<Manifest | null> {
  const path = process.env["TF_RECORDING_CATALOG_FILE"];
  if (path === undefined) return null;
  try {
    const manifest = isLocalPath(path) ? await readManifest(path) : null;
    if (manifest !== null) return manifest;
  } catch {
    // Never expose operator paths, private evidence, or parser diagnostics.
  }
  throw new RecordingCatalogError();
}

export const defaultRecordingCatalog: RecordingCatalog = {
  async candidates(entry) {
    const current = await currentManifest();
    if (current === null) return { status: "unconfigured", candidates: [] };
    return {
      status: "ready",
      candidates: current.entries
        .filter(matchesEntry(entry))
        .map(candidate)
        .sort(compareCandidates)
        .slice(0, MAX_CANDIDATES),
    };
  },
  async mediaBinding(entry, selection, operation) {
    const current = await currentManifest();
    if (current === null) return { status: "unconfigured" };
    const record = current.entries.find(
      ({ id }) => id === selection.candidateId,
    );
    if (
      !record ||
      !matchesEntry(entry)(record) ||
      evidenceRevision(record) !== selection.evidenceRevision
    ) {
      return { status: "stale" };
    }
    if (
      !record.media ||
      recordingAccess(record) !== "full" ||
      (operation === "file" && record.downloadPermission !== "permitted")
    )
      return { status: "not_permitted" };
    return { status: "ready", binding: record.media };
  },
};
