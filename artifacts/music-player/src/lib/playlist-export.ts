import type { PlaylistDetailResponse } from "@workspace/api-client-react";

function exportFilename(name: string, format: "json" | "csv"): string {
  const sanitized = name
    .replace(/[<>:"/\\|?*\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/gu, "")
    .trim();
  const encoder = new TextEncoder();
  let bounded = "";
  let byteLength = 0;

  // Leave room for the prefix and extension without splitting Unicode characters.
  for (const character of sanitized) {
    const size = encoder.encode(character).length;
    if (byteLength + size > 180) break;
    bounded += character;
    byteLength += size;
  }

  const stem = bounded.replace(/[. ]+$/, "") || "playlist";
  return `Apollo TF - ${stem}.${format}`;
}

function csvCell(value: string): string {
  // Quoting alone does not stop spreadsheet formulas, including hidden prefixes.
  const safeValue = /^[\s\p{Cc}\p{Cf}]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/u.test(value)
    ? `'${value}`
    : value;
  return /[",\r\n]/.test(safeValue)
    ? `"${safeValue.replace(/"/g, '""')}"`
    : safeValue;
}

export function buildPlaylistExport(
  detail: PlaylistDetailResponse,
  format: "json" | "csv",
): { filename: string; mimeType: string; content: string } {
  if (detail.playlist.trackCount !== detail.tracks.length) {
    throw new Error("Cannot export playlist: track count does not match received tracks.");
  }

  const filename = exportFilename(detail.playlist.name, format);
  if (format === "json") {
    return {
      filename,
      mimeType: "application/json;charset=utf-8",
      content: JSON.stringify({
        schemaVersion: "apollo.tf.playlist-export.v1",
        playlist: {
          name: detail.playlist.name,
          description: detail.playlist.description,
        },
        tracks: detail.tracks.map((track) => ({
          artist: track.artist,
          title: track.title,
          durationSeconds: track.durationSeconds,
        })),
      }, null, 2),
    };
  }

  const rows = detail.tracks.map((track, index) => [
    index + 1,
    csvCell(track.artist),
    csvCell(track.title),
    track.durationSeconds ?? "",
  ].join(",") + "\r\n");

  return {
    filename,
    mimeType: "text/csv;charset=utf-8",
    content: "\uFEFFposition,artist,title,duration_seconds\r\n" + rows.join(""),
  };
}
