import type { PlaylistDetailResponse } from "@workspace/api-client-react";
import { describe, expect, it } from "vitest";
import { buildPlaylistExport } from "./playlist-export";

function playlistDetail(): PlaylistDetailResponse {
  const detail = {
    identity: { accountId: "private-account" },
    playlist: {
      id: 71,
      name: "Night mix",
      description: "A personal selection",
      trackCount: 2,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
      ownerId: "private-owner",
      imageUrl: "https://example.invalid/playlist.jpg",
    },
    tracks: [
      {
        trackId: "yt_private_first",
        artist: "Zeta",
        title: "Second alphabetically",
        durationSeconds: 211,
        position: 9,
        thumbnailUrl: "https://example.invalid/first.jpg",
        addedAt: "2026-01-02T00:00:00Z",
        streamUrl: "https://example.invalid/first.mp3",
        internalMetadata: { source: "private-source" },
      },
      {
        trackId: "sc_private_second",
        artist: "Alpha",
        title: "First alphabetically",
        durationSeconds: null,
        position: 2,
        thumbnailUrl: "https://example.invalid/second.jpg",
        addedAt: "2026-01-01T00:00:00Z",
      },
    ],
  };
  return detail;
}

describe("playlist metadata export", () => {
  it("projects only public metadata into versioned JSON in received order", () => {
    const detail = playlistDetail();
    const before = structuredClone(detail);
    const exported = buildPlaylistExport(detail, "json");

    expect(exported.filename).toBe("Apollo TF - Night mix.json");
    expect(exported.mimeType).toBe("application/json;charset=utf-8");
    expect(JSON.parse(exported.content)).toEqual({
      schemaVersion: "apollo.tf.playlist-export.v1",
      playlist: { name: "Night mix", description: "A personal selection" },
      tracks: [
        { artist: "Zeta", title: "Second alphabetically", durationSeconds: 211 },
        { artist: "Alpha", title: "First alphabetically", durationSeconds: null },
      ],
    });
    expect(detail).toEqual(before);
  });

  it("writes only CSV metadata with BOM, CRLF, displayed positions and escaped cells", () => {
    const detail = playlistDetail();
    detail.tracks[0].artist = 'The "Band", Inc.';
    detail.tracks[0].title = "Line 1\r\nLine 2\nLine 3\rLine 4";
    detail.tracks[1].artist = "  Ordinary Artist ";
    detail.tracks[1].title = "AC+DC - live";
    const before = structuredClone(detail);
    const exported = buildPlaylistExport(detail, "csv");

    expect(exported.filename).toBe("Apollo TF - Night mix.csv");
    expect(exported.mimeType).toBe("text/csv;charset=utf-8");
    expect(exported.content).toBe(
      "\uFEFFposition,artist,title,duration_seconds\r\n" +
      '1,"The ""Band"", Inc.","Line 1\r\nLine 2\nLine 3\rLine 4",211\r\n' +
      "2,  Ordinary Artist ,AC+DC - live,\r\n",
    );
    expect([...new TextEncoder().encode(exported.content).slice(0, 3)]).toEqual([239, 187, 191]);
    expect(detail).toEqual(before);
  });

  it("neutralizes formula prefixes in both CSV text columns without changing JSON values", () => {
    const cases = [
      ["=1+1", "'=1+1"],
      ["+1", "'+1"],
      ["-1", "'-1"],
      ["@SUM(A1)", "'@SUM(A1)"],
      [" \t=1", "' \t=1"],
      ["\u0000\u001f+1", "'\u0000\u001f+1"],
      ["\u007f\u0085-1", "'\u007f\u0085-1"],
      ["\u00a0\u200b@SUM(A1)", "'\u00a0\u200b@SUM(A1)"],
      ["\r\n=1", '"\'\r\n=1"'],
      ['=CONCAT("a","b")', '"\'=CONCAT(""a"",""b"")"'],
      ["\uFF1D1", "'\uFF1D1"],
      [" \uFF0B1", "' \uFF0B1"],
      ["\t\uFF0D1", "'\t\uFF0D1"],
      ["\uFEFF\uFF20SUM(A1)", "'\uFEFF\uFF20SUM(A1)"],
    ];

    for (const [input, csvCell] of cases) {
      const detail = playlistDetail();
      detail.playlist.name = input;
      detail.playlist.description = input;
      detail.playlist.trackCount = 1;
      detail.tracks = [{ ...detail.tracks[0], artist: input, title: input }];

      expect(buildPlaylistExport(detail, "csv").content, JSON.stringify(input)).toBe(
        "\uFEFFposition,artist,title,duration_seconds\r\n" +
        `1,${csvCell},${csvCell},211\r\n`,
      );
      expect(JSON.parse(buildPlaylistExport(detail, "json").content)).toEqual({
        schemaVersion: "apollo.tf.playlist-export.v1",
        playlist: { name: input, description: input },
        tracks: [{ artist: input, title: input, durationSeconds: 211 }],
      });
    }
  });

  it("exports an empty playlist and retains a null description", () => {
    const detail = playlistDetail();
    detail.playlist.description = null;
    detail.playlist.trackCount = 0;
    detail.tracks = [];

    expect(JSON.parse(buildPlaylistExport(detail, "json").content)).toEqual({
      schemaVersion: "apollo.tf.playlist-export.v1",
      playlist: { name: "Night mix", description: null },
      tracks: [],
    });
    expect(buildPlaylistExport(detail, "csv").content).toBe(
      "\uFEFFposition,artist,title,duration_seconds\r\n",
    );
  });

  it("rejects incomplete or inconsistent responses in either format", () => {
    for (const format of ["json", "csv"] as const) {
      for (const trackCount of [0, 1, 3]) {
        const detail = playlistDetail();
        detail.playlist.trackCount = trackCount;
        expect(() => buildPlaylistExport(detail, format)).toThrow(Error);
      }
      const detail = playlistDetail();
      detail.tracks = [];
      expect(() => buildPlaylistExport(detail, format)).toThrow(Error);
    }
  });

  it("retains Unicode playlist names with the exact selected extension", () => {
    const detail = playlistDetail();
    detail.playlist.name = "\u041d\u043e\u0447\u044c \u6771\u4eac \u{1f3b5}";
    for (const format of ["json", "csv"] as const) {
      expect(buildPlaylistExport(detail, format).filename).toBe(
        `Apollo TF - \u041d\u043e\u0447\u044c \u6771\u4eac \u{1f3b5}.${format}`,
      );
    }
  });

  it("removes Windows-forbidden, control and bidi characters and handles empty names", () => {
    const cases = [
      ['CON<>:"/\\|?*\u0000\u001f\u007f\u0085\u061c\u200e\u200f\u202a\u202e\u2066\u2069.  ', "CON"],
      ["  Night mix...  ", "Night mix"],
      ["", "playlist"],
      ['<>:"/\\|?*\u0000\u202e...  ', "playlist"],
    ];
    for (const format of ["json", "csv"] as const) {
      for (const [name, safeName] of cases) {
        const detail = playlistDetail();
        detail.playlist.name = name;
        expect(buildPlaylistExport(detail, format).filename).toBe(`Apollo TF - ${safeName}.${format}`);
      }
    }
  });

  it("bounds long Unicode filenames without splitting characters or leaving trailing dots or spaces", () => {
    for (const name of ["\u{1f3b5}".repeat(200), "\u0436".repeat(400), "a. ".repeat(200)]) {
      const detail = playlistDetail();
      detail.playlist.name = name;
      for (const format of ["json", "csv"] as const) {
        const { filename } = buildPlaylistExport(detail, format);
        expect(filename.startsWith("Apollo TF - ")).toBe(true);
        expect(filename.endsWith(`.${format}`)).toBe(true);
        expect(new TextEncoder().encode(filename).length).toBeLessThanOrEqual(240);
        expect(filename).not.toMatch(/[\uD800-\uDFFF]/u);
        const stem = filename.slice("Apollo TF - ".length, -(format.length + 1));
        expect(stem).not.toBe("");
        expect(name.startsWith(stem)).toBe(true);
        expect(stem).not.toMatch(/[. ]$/);
      }
    }
  });
});
