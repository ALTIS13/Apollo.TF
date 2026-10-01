import { describe, expect, it } from "vitest";
import type { InternalTrack } from "./search-service.js";
import type { RecordingDurationReference } from "./recording-reference.js";
import {
  assessMediaCompleteness,
  filterCompleteMedia,
} from "./media-completeness.js";

function track(overrides: Partial<InternalTrack> = {}): InternalTrack {
  return {
    id: "yt_full",
    title: "Track",
    artist: "Artist",
    type: "original",
    duration: 210,
    source: "youtube",
    thumbnailUrl: null,
    quality: ["128"],
    viewCount: 1_000,
    score: 0,
    sourceUrl: "https://www.youtube.com/watch?v=full",
    ...overrides,
  };
}

function reference(
  overrides: Partial<RecordingDurationReference> = {},
): RecordingDurationReference {
  return { artist: "Artist", title: "Track", type: "original", duration: 210, ...overrides };
}

describe("media completeness gate", () => {
  it.each([
    [
      "provider preview URL",
      track({
        id: "dz_preview",
        source: "deezer",
        sourceUrl: "https://cdns-preview-a.dzcdn.net/stream/c-a-preview.mp3",
      }),
      210,
      "provider_preview_url",
    ],
    [
      "opaque Deezer preview CDN URL",
      track({
        id: "dz_opaque_preview",
        source: "deezer",
        sourceUrl: "https://e-cdns-proxy.dzcdn.net/stream/c-a-opaque.mp3",
      }),
      210,
      "provider_preview_url",
    ],
    [
      "title marker",
      track({ id: "yt_demo", title: "Track (30 sec preview)" }),
      210,
      "title_marker",
    ],
    [
      "Cyrillic title marker",
      track({ id: "yt_demo_ru", title: "Трек (демо)" }),
      210,
      "title_marker",
    ],
    [
      "Russian duration marker",
      track({ id: "yt_30_seconds_ru", title: "Трек 30 сек" }),
      210,
      "title_marker",
    ],
    [
      "duration outlier",
      track({ id: "sc_short", source: "soundcloud", duration: 72 }),
      210,
      "duration_outlier",
    ],
    ["full track", track(), 210, undefined],
  ] as const)(
    "classifies %s",
    (_label, candidate, referenceDuration, reason) => {
      expect(assessMediaCompleteness(candidate, referenceDuration)).toEqual(
        reason === undefined ? { complete: true } : { complete: false, reason },
      );
    },
  );

  it("filters rejected media and reports bounded counts by source and reason", () => {
    const result = filterCompleteMedia([
      track(),
      track({
        id: "dz_preview",
        source: "deezer",
        sourceUrl: "https://cdns-preview-a.dzcdn.net/stream/c-a-preview.mp3",
      }),
      track({
        id: "sc_short",
        source: "soundcloud",
        duration: 72,
      }),
    ]);

    expect(result.accepted.map((candidate) => candidate.id)).toEqual([
      "yt_full",
    ]);
    expect(result.rejected).toEqual([
      {
        source: "soundcloud",
        reason: "duration_outlier",
        count: 1,
      },
      {
        source: "deezer",
        reason: "provider_preview_url",
        count: 1,
      },
    ]);
  });

  it("averages agreeing peer durations for the same recording", () => {
    const result = filterCompleteMedia([
      track({ id: "reference_160", duration: 160 }),
      track({ id: "reference_162", duration: 162 }),
      track({ id: "candidate_89", duration: 89 }),
    ]);

    expect(result.accepted.map((candidate) => candidate.id)).toEqual([
      "reference_160",
      "reference_162",
      "candidate_89",
    ]);
    expect(result.rejected).toEqual([]);
  });

  it("does not let multiple 30-second originals redefine a known full duration", () => {
    const result = filterCompleteMedia([
      track({ id: "yt_full", duration: 210 }),
      track({ id: "yt_preview_one", duration: 30 }),
      track({ id: "sc_preview_two", source: "soundcloud", duration: 32 }),
    ]);

    expect(result.accepted.map((candidate) => candidate.id)).toEqual(["yt_full"]);
    expect(result.rejected).toEqual([
      { source: "youtube", reason: "duration_outlier", count: 1 },
      { source: "soundcloud", reason: "duration_outlier", count: 1 },
    ]);
  });

  it("uses catalog duration without admitting a Deezer preview as audio", () => {
    const result = filterCompleteMedia([
      track({
        id: "dz_preview",
        source: "deezer",
        duration: 205,
        sourceUrl: "https://cdns-preview-a.dzcdn.net/stream/c-a-preview.mp3",
      }),
      track({ id: "yt_preview", duration: 30 }),
    ]);

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      { source: "youtube", reason: "duration_outlier", count: 1 },
      { source: "deezer", reason: "provider_preview_url", count: 1 },
    ]);
  });

  it("keeps a genuinely short recording when there is no full-length reference", () => {
    const short = track({ id: "yt_short", duration: 25 });
    expect(filterCompleteMedia([short]).accepted).toEqual([short]);
  });

  it("detects a 30-second excerpt of a 95-second original", () => {
    const result = filterCompleteMedia([
      track({ id: "yt_full", duration: 95 }),
      track({ id: "sc_excerpt", source: "soundcloud", duration: 30 }),
    ]);
    expect(result.accepted.map((candidate) => candidate.id)).toEqual(["yt_full"]);
    expect(result.rejected).toEqual([
      { source: "soundcloud", reason: "duration_outlier", count: 1 },
    ]);
  });

  it.each([
    { title: "Interlude" },
    { artist: "Another Artist" },
  ])("does not borrow a long duration from another song or artist: %j", (identity) => {
    const short = track({ id: "yt_short", duration: 25, ...identity });
    const full = track();
    const result = filterCompleteMedia([full, short], [reference()]);
    expect(result.accepted).toEqual([full, short]);
    expect(result.rejected).toEqual([]);
  });

  it.each([
    ["Track", "live"],
    ["Track", "remix"],
    ["Track", "cover"],
    ["Track (2011 Remaster)", "original"],
    ["Track (Clean)", "original"],
    ["Track (Explicit)", "original"],
    ["Track (Radio Edit)", "remix"],
    ["Track (Acoustic Version)", "live"],
  ] as const)("keeps %s / %s distinct from the original", (title, type) => {
    const full = track();
    const variant = track({ id: "yt_variant", title, type, duration: 75 });
    const result = filterCompleteMedia([full, variant], [reference()]);
    expect(result.accepted).toEqual([full, variant]);
    expect(result.rejected).toEqual([]);
  });

  it.each([
    ["Artist", "Track"],
    ["Artist", "ARTIST - Track (Official Music Video) [HD]"],
    ["Artist - Topic", "Artist - Track [Official Audio]"],
    ["ArtistVEVO", "Artist - Track (Lyrics)"],
    ["Artist VEVO", "Artist: Track (Official Video)"],
    ["Artist - vevo", "Artist - Track [Official Audio]"],
  ])("matches catalog metadata for the known uploader %s and title %s", (artist, title) => {
    const excerpt = track({ artist, title, duration: 30 });
    const result = filterCompleteMedia([excerpt], [reference()]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([
      { source: "youtube", reason: "duration_outlier", count: 1 },
    ]);
  });

  it.each(["Unknown", "Music Archive", "ArtistVEVO extras", "Artist Topic"])(
    "does not infer the recording artist from a title on channel %s",
    (artist) => {
      const candidate = track({ artist, title: "Artist - Track (Official Audio)", duration: 30 });
      const otherSong = track({ id: "yt_other_song", title: "Another Song" });
      const result = filterCompleteMedia([otherSong, candidate], [reference()]);
      expect(result.accepted).toEqual([otherSong, candidate]);
      expect(result.rejected).toEqual([]);
    },
  );

  it.each(["2011 Remaster", "Clean"])(
    "matches presentation differences without dropping the %s qualifier",
    (qualifier) => {
      const result = filterCompleteMedia([
        track({ title: `Artist - Track - ${qualifier} (Official Audio)`, duration: 30 }),
      ], [reference({ title: `Track (${qualifier})` })]);
      expect(result.accepted).toEqual([]);
      expect(result.rejected).toEqual([
        { source: "youtube", reason: "duration_outlier", count: 1 },
      ]);
    },
  );

  it("uses a genuine short catalog recording instead of a longer matching peer", () => {
    const short = track({ id: "yt_short", duration: 25 });
    const full = track();
    const result = filterCompleteMedia([full, short], [reference({ duration: 25 })]);
    expect(result.accepted).toEqual([full, short]);
    expect(result.rejected).toEqual([]);
  });

  it("does not manufacture a full-length reference from conflicting catalog lengths", () => {
    const short = track({ id: "yt_short", duration: 25 });
    const otherSong = track({ id: "yt_other_song", title: "Another Song" });
    const result = filterCompleteMedia([otherSong, short], [
      reference({ duration: 25 }), reference(), reference({ duration: 330 }),
    ]);
    expect(result.accepted).toEqual([otherSong, short]);
    expect(result.rejected).toEqual([]);
  });

  it("does not override ambiguous matching catalog metadata with a long media peer", () => {
    const full = track({ id: "sc_full", source: "soundcloud" });
    const short = track({ duration: 30 });
    const result = filterCompleteMedia([full, short], [
      reference({ duration: 25 }), reference({ duration: 210 }),
    ]);
    expect(result.accepted).toEqual([full, short]);
    expect(result.rejected).toEqual([]);
  });

  it("preserves the legitimate artist name Avevo instead of treating it as A's VEVO uploader", () => {
    const candidate = track({ artist: "Avevo", duration: 30 });
    expect(filterCompleteMedia([candidate], [reference({ artist: "A" })])).toEqual({
      accepted: [candidate], rejected: [],
    });
    expect(filterCompleteMedia([candidate], [reference({ artist: "Avevo" })])).toEqual({
      accepted: [], rejected: [{ source: "youtube", reason: "duration_outlier", count: 1 }],
    });
  });

  it("does not use conflicting Deezer preview metadata as matching audio peers", () => {
    const preview = track({
      id: "dz_long", source: "deezer",
      sourceUrl: "https://cdns-preview-a.dzcdn.net/stream/preview.mp3",
    });
    const short = track({ duration: 25 });
    const result = filterCompleteMedia([
      preview, { ...preview, id: "dz_short", duration: 25 }, short,
    ]);
    expect(result.accepted).toEqual([short]);
    expect(result.rejected).toEqual([
      { source: "deezer", reason: "provider_preview_url", count: 2 },
    ]);
  });

  it("leaves conflicting matching audio peer lengths unknown", () => {
    const peers = [track({ id: "yt_120", duration: 120 }), track({ id: "sc_240", duration: 240 })];
    const short = track({ duration: 30 });
    const result = filterCompleteMedia([...peers, short]);
    expect(result.accepted).toEqual([...peers, short]);
    expect(result.rejected).toEqual([]);
  });

  it("uses matching live peers rather than an unrelated original", () => {
    const live = track({ id: "yt_live", title: "Track (Live)", type: "live" });
    const excerpt = track({ id: "sc_live_excerpt", source: "soundcloud", title: "Track (Live)", type: "live", duration: 30 });
    const result = filterCompleteMedia([live, excerpt]);
    expect(result.accepted).toEqual([live]);
    expect(result.rejected).toEqual([
      { source: "soundcloud", reason: "duration_outlier", count: 1 },
    ]);
  });

  it("ignores invalid catalog references rather than treating them as full-length metadata", () => {
    const short = track({ duration: 25 });
    const invalid = [
      ...[0, -1, NaN, Infinity, 86_401, 210.5].map((duration) => reference({ duration })),
      reference({ artist: " " }), reference({ title: " " }), reference({ artist: "Unknown" }),
      { ...reference(), type: "unsupported" } as unknown as RecordingDurationReference,
      null as unknown as RecordingDurationReference,
    ];
    expect(filterCompleteMedia([short], invalid)).toEqual({ accepted: [short], rejected: [] });
  });
});
