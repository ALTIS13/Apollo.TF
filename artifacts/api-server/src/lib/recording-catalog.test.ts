import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultRecordingCatalog,
  RecordingCatalogError,
} from "./recording-catalog.js";

const envName = "TF_RECORDING_CATALOG_FILE";
const roots: string[] = [];
const entry = { artist: "Artist Name", title: "Song", durationSeconds: 240 };
const catalogError = {
  name: "RecordingCatalogError",
  message: "Recording catalog unavailable",
};

const reviewedEvidence = {
  recordId: "private-rights-record-a",
  basis: "Direct permission recorded by the curator",
  observedDate: "2025-03-04",
  reviewed: true,
};

function recording(overrides: Record<string, unknown> = {}) {
  return {
    id: "original-recording",
    artist: "Artist Name",
    title: "Song",
    matchTitle: "Song",
    edition: "original",
    releaseDate: "2003-08-19",
    expectedDurationSeconds: 240,
    measuredDurationSeconds: 243,
    mediaKind: "full",
    streamPermission: "permitted",
    downloadPermission: "not_permitted",
    evidence: reviewedEvidence,
    sourceLabel: "Artist archive",
    sourceUrl: "https://archive.example.test/recordings/song",
    ...overrides,
  };
}

function manifest(entries: unknown[]) {
  return JSON.stringify({ schemaVersion: 1, entries });
}

async function configure(contents?: string | Buffer): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tf-recording-catalog-"));
  roots.push(root);
  const file = join(root, "recordings.json");
  if (contents !== undefined) await writeFile(file, contents);
  vi.stubEnv(envName, file);
  return file;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("reviewed recording catalog", () => {
  it("matches only normalized artist and explicit match title and ranks curator editions", async () => {
    const contents = manifest([
      recording({
        id: "z-alternate",
        title: "Song (Alternate)",
        edition: "alternate",
      }),
      recording({
        id: "unknown",
        title: "Song (Original?)",
        edition: "unknown",
        mediaKind: "unknown",
        releaseDate: "1902-04-02",
      }),
      recording({
        id: "clean",
        title: "Song (Clean Edit)",
        edition: "clean_edit",
        downloadPermission: "permitted",
      }),
      recording({
        id: "unrelated-live",
        title: "Song (Live)",
        matchTitle: "Song (Live)",
      }),
      recording({ id: "wrong-artist", artist: "Artist Name feat. Another" }),
      recording(),
    ]);
    await configure(contents);
    const network = vi.fn();
    vi.stubGlobal("fetch", network);

    const result = await defaultRecordingCatalog.candidates({
      artist: "  artist\t NAME ",
      title: "  SONG ",
      durationSeconds: 30,
    });

    expect(result.status).toBe("ready");
    expect(
      result.candidates.map(({ id, edition, access, download }) => ({
        id,
        edition,
        access,
        download,
      })),
    ).toEqual([
      {
        id: "original-recording",
        edition: "original",
        access: "full",
        download: "not_permitted",
      },
      {
        id: "clean",
        edition: "clean_edit",
        access: "full",
        download: "permitted",
      },
      {
        id: "z-alternate",
        edition: "alternate",
        access: "full",
        download: "not_permitted",
      },
      {
        id: "unknown",
        edition: "unknown",
        access: "unverified",
        download: "not_permitted",
      },
    ]);
    expect(result.candidates[0]).toEqual({
      id: "original-recording",
      evidenceRevision: expect.stringMatching(/^[0-9a-f]{64}$/),
      artist: "Artist Name",
      title: "Song",
      edition: "original",
      releaseDate: "2003-08-19",
      expectedDurationSeconds: 240,
      measuredDurationSeconds: 243,
      access: "full",
      download: "not_permitted",
      sourceLabel: "Artist archive",
      sourceUrl: "https://archive.example.test/recordings/song",
    });
    expect(JSON.stringify(result)).not.toContain(reviewedEvidence.recordId);
    expect(JSON.stringify(result)).not.toContain(reviewedEvidence.basis);
    await expect(
      defaultRecordingCatalog.candidates({
        ...entry,
        title: "Song (Clean Edit)",
      }),
    ).resolves.toEqual({ status: "ready", candidates: [] });
    await expect(
      defaultRecordingCatalog.candidates({ ...entry, title: "Song (Live)" }),
    ).resolves.toMatchObject({ candidates: [{ id: "unrelated-live" }] });
    expect(network).not.toHaveBeenCalled();
  });

  it("uses exact normalized Unicode, caps results, and breaks version ties by ID", async () => {
    await configure(
      manifest(
        Array.from({ length: 14 }, (_, index) =>
          recording({
            id: `recording-${String(13 - index).padStart(2, "0")}`,
            artist: "Caf\u00e9",
            matchTitle: "A Song!",
          }),
        ),
      ),
    );
    const result = await defaultRecordingCatalog.candidates({
      ...entry,
      artist: "CAFE\u0301",
      title: "a  song!",
    });
    expect(result.status).toBe("ready");
    expect(result.candidates.map(({ id }) => id)).toEqual(
      Array.from(
        { length: 12 },
        (_, index) => `recording-${String(index).padStart(2, "0")}`,
      ),
    );
    await expect(
      defaultRecordingCatalog.candidates({
        ...entry,
        artist: "Caf\u00e9",
        title: "A Song",
      }),
    ).resolves.toEqual({ status: "ready", candidates: [] });
  });

  it("distinguishes 30-second previews and uncertain measurements from independently confirmed short full recordings", async () => {
    await configure(
      manifest([
        recording({
          id: "declared-preview",
          mediaKind: "preview",
          measuredDurationSeconds: 30,
          downloadPermission: "permitted",
        }),
        recording({
          id: "truncated-full",
          measuredDurationSeconds: 30,
          downloadPermission: "permitted",
        }),
        recording({
          id: "short-full",
          expectedDurationSeconds: 30,
          measuredDurationSeconds: 30,
          downloadPermission: "permitted",
        }),
        recording({
          id: "near-but-outside",
          measuredDurationSeconds: 235,
          downloadPermission: "permitted",
        }),
        recording({
          id: "unmeasured",
          measuredDurationSeconds: null,
          downloadPermission: "permitted",
        }),
        recording({
          id: "unknown-media",
          mediaKind: "unknown",
          downloadPermission: "permitted",
        }),
      ]),
    );

    const { candidates } = await defaultRecordingCatalog.candidates(entry);
    expect(
      Object.fromEntries(
        candidates.map(({ id, access, download }) => [id, [access, download]]),
      ),
    ).toEqual({
      "declared-preview": ["preview", "not_permitted"],
      "truncated-full": ["preview", "not_permitted"],
      "short-full": ["full", "permitted"],
      "near-but-outside": ["unverified", "unverified"],
      unmeasured: ["unverified", "unverified"],
      "unknown-media": ["unverified", "unverified"],
    });
  });

  it("requires reviewed evidence and separate explicit permissions", async () => {
    await configure(
      manifest([
        recording({ id: "stream-only", downloadPermission: "unverified" }),
        recording({
          id: "download-only",
          streamPermission: "not_permitted",
          downloadPermission: "permitted",
        }),
        recording({
          id: "no-stream-evidence",
          streamPermission: "unverified",
          downloadPermission: "permitted",
        }),
        recording({
          id: "unreviewed",
          evidence: { ...reviewedEvidence, reviewed: false },
          downloadPermission: "permitted",
        }),
        recording({
          id: "no-evidence",
          evidence: null,
          downloadPermission: "permitted",
        }),
      ]),
    );

    const { candidates } = await defaultRecordingCatalog.candidates(entry);
    expect(
      Object.fromEntries(
        candidates.map(({ id, access, download }) => [id, [access, download]]),
      ),
    ).toEqual({
      "stream-only": ["full", "unverified"],
      "download-only": ["blocked", "not_permitted"],
      "no-stream-evidence": ["unverified", "unverified"],
      unreviewed: ["unverified", "unverified"],
      "no-evidence": ["unverified", "unverified"],
    });
  });

  it("reloads evidence bytes even with unchanged size and mtime and never serves stale data", async () => {
    const contents = manifest([recording()]);
    const file = await configure(contents);
    const timestamp = new Date("2025-01-01T00:00:00.000Z");
    await utimes(file, timestamp, timestamp);
    const first = await defaultRecordingCatalog.candidates(entry);
    const changed = contents.replace(
      reviewedEvidence.recordId,
      "private-rights-record-b",
    );
    await writeFile(file, changed);
    await utimes(file, timestamp, timestamp);
    const second = await defaultRecordingCatalog.candidates(entry);
    expect(first.candidates[0]?.evidenceRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(second.candidates[0]?.evidenceRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(second.candidates[0]?.evidenceRevision).not.toBe(
      first.candidates[0]?.evidenceRevision,
    );

    await writeFile(file, "invalid catalog content");
    await expect(
      defaultRecordingCatalog.candidates(entry),
    ).rejects.toMatchObject(catalogError);
  });

  it("keeps a matching revision stable across unrelated record and JSON formatting changes", async () => {
    const matching = recording();
    const unrelated = recording({ id: "other", matchTitle: "Other" });
    const file = await configure(manifest([matching, unrelated]));
    const first = await defaultRecordingCatalog.candidates(entry);
    const originalRevision = first.candidates[0]?.evidenceRevision;
    expect(originalRevision).toMatch(/^[0-9a-f]{64}$/);

    const reordered = Object.fromEntries(Object.entries(matching).reverse());
    await writeFile(
      file,
      JSON.stringify(
        {
          entries: [{ ...unrelated, measuredDurationSeconds: 20 }, reordered],
          schemaVersion: 1,
        },
        null,
        2,
      ),
    );
    const second = await defaultRecordingCatalog.candidates(entry);
    expect(second.candidates[0]?.evidenceRevision).toBe(originalRevision);
  });

  it("accepts published slug, label, and lowercase HTTPS URL boundaries", async () => {
    const id = `a_${"x".repeat(62)}`;
    const sourceLabel = "x".repeat(160);
    const sourceUrl = "https://archive.example.test/".padEnd(4096, "x");
    await configure(manifest([recording({ id, sourceLabel, sourceUrl })]));
    await expect(
      defaultRecordingCatalog.candidates(entry),
    ).resolves.toMatchObject({
      status: "ready",
      candidates: [{ id, sourceLabel, sourceUrl }],
    });
  });

  it("fails closed for unset, missing, non-file, remote, oversized or malformed UTF-8 configuration", async () => {
    vi.stubEnv(envName, undefined);
    await expect(defaultRecordingCatalog.candidates(entry)).resolves.toEqual({
      status: "unconfigured",
      candidates: [],
    });
    vi.stubEnv(envName, "");
    await expect(
      defaultRecordingCatalog.candidates(entry),
    ).rejects.toMatchObject(catalogError);
    const file = await configure();
    const missing = defaultRecordingCatalog.candidates(entry);
    await expect(missing).rejects.toBeInstanceOf(RecordingCatalogError);
    await expect(missing).rejects.toMatchObject(catalogError);
    await expect(missing).rejects.not.toHaveProperty("cause");
    vi.stubEnv(envName, roots.at(-1)!);
    await expect(
      defaultRecordingCatalog.candidates(entry),
    ).rejects.toMatchObject(catalogError);
    vi.stubEnv(envName, "https://archive.example.test/recordings.json");
    await expect(
      defaultRecordingCatalog.candidates(entry),
    ).rejects.toMatchObject(catalogError);
    vi.stubEnv(envName, file);
    await writeFile(file, manifest([recording()]).padEnd(512 * 1024 + 1));
    await expect(
      defaultRecordingCatalog.candidates(entry),
    ).rejects.toMatchObject(catalogError);
    const prefix = manifest([recording({ sourceLabel: "PLACEHOLDER" })]).split(
      "PLACEHOLDER",
    );
    await writeFile(
      file,
      Buffer.concat([
        Buffer.from(prefix[0]!),
        Buffer.from([0xff]),
        Buffer.from(prefix[1]!),
      ]),
    );
    await expect(
      defaultRecordingCatalog.candidates(entry),
    ).rejects.toMatchObject(catalogError);
    await writeFile(file, manifest([]));
    await expect(defaultRecordingCatalog.candidates(entry)).resolves.toEqual({
      status: "ready",
      candidates: [],
    });
  });

  it.each([
    [
      "duplicate IDs across matches",
      manifest([recording(), recording({ matchTitle: "Other" })]),
    ],
    [
      "unknown schema version",
      JSON.stringify({ schemaVersion: 2, entries: [recording()] }),
    ],
    [
      "unknown field",
      manifest([recording({ mediaUrl: "https://example.test/media" })]),
    ],
    [
      "missing explicit match title",
      manifest([recording({ matchTitle: undefined })]),
    ],
    ["uppercase ID", manifest([recording({ id: "UpperCase" })])],
    ["overlong ID", manifest([recording({ id: "a".repeat(65) })])],
    [
      "overlong source label",
      manifest([recording({ sourceLabel: "x".repeat(161) })]),
    ],
    [
      "overlong source URL",
      manifest([
        recording({ sourceUrl: "https://example.test/".padEnd(4097, "x") }),
      ]),
    ],
    [
      "invalid duration",
      manifest([recording({ measuredDurationSeconds: 240.5 })]),
    ],
    [
      "invalid date",
      manifest([
        recording({
          evidence: { ...reviewedEvidence, observedDate: "2025-02-29" },
        }),
      ]),
    ],
    [
      "invalid stream permission",
      manifest([recording({ streamPermission: true })]),
    ],
    [
      "non-HTTPS source",
      manifest([recording({ sourceUrl: "http://example.test/recording" })]),
    ],
    [
      "uppercase HTTPS scheme",
      manifest([recording({ sourceUrl: "HTTPS://example.test/recording" })]),
    ],
    [
      "source with credentials",
      manifest([
        recording({ sourceUrl: "https://user:secret@example.test/recording" }),
      ]),
    ],
    [
      "overlong evidence ID",
      manifest([
        recording({
          evidence: { ...reviewedEvidence, recordId: "a".repeat(129) },
        }),
      ]),
    ],
  ])(
    "fails closed on %s without returning partial candidates",
    async (_label, contents) => {
      await configure(contents);
      await expect(
        defaultRecordingCatalog.candidates(entry),
      ).rejects.toMatchObject(catalogError);
    },
  );
});
