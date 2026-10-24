import type { TfSearchResult, TfSearchResultSource } from "@workspace/tf-search-contract";

export interface RecordingDurationReference {
  readonly artist: string;
  readonly title: string;
  readonly type: TfSearchResult["type"];
  readonly duration: number;
}

const RECORDING_TYPES: readonly RecordingDurationReference["type"][] = [
  "original", "remix", "live", "cover",
];
const PRESENTATION_LABEL =
  "(?:official (?:music )?video|official audio|official (?:lyric|lyrics) video|lyric video|lyrics|official visualizer|visualizer|audio|hd|hq|4k)";
const PRESENTATION_SUFFIX = new RegExp(
  `\\s*(?:\\(\\s*${PRESENTATION_LABEL}\\s*\\)|\\[\\s*${PRESENTATION_LABEL}\\s*\\]|\\s[-|]\\s${PRESENTATION_LABEL})$`,
  "u",
);

function normalizeText(value: string): string {
  return value.normalize("NFC").toLowerCase()
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[\u201c\u201d]/gu, '"')
    .replace(/[\u2010-\u2014]/gu, "-")
    .replace(/\s+/gu, " ").trim();
}

export function recordingReferenceKey(
  recording: RecordingDurationReference,
  source?: TfSearchResultSource,
): string | undefined {
  if (!recording || typeof recording.artist !== "string" || typeof recording.title !== "string"
    || recording.artist.length > 300 || recording.title.length > 500
    || !RECORDING_TYPES.includes(recording.type)) return undefined;

  let artist = normalizeText(recording.artist);
  let title = normalizeText(recording.title);
  if (source === "youtube") {
    // Only exact uploader suffixes; never extract an artist from an unrelated channel's title.
    artist = artist.replace(/\s+-\s+topic$/u, "").trim();
    const vevoUploader = /VEVO\s*$/u.test(recording.artist)
      || /(?:\s+|[-|\u2010-\u2014]\s*)vevo\s*$/iu.test(recording.artist);
    // Check the original casing/separator before case folding: Avevo is an artist, not A + VEVO.
    if (vevoUploader) artist = artist.replace(/(?:\s*[-|])?\s*vevo$/u, "").trim();
  }
  if (!artist || /^(?:unknown|unknown artist)$/u.test(artist)) return undefined;

  if (source === "youtube" && title.startsWith(artist)) {
    const remainder = title.slice(artist.length);
    if (/^\s*[-:|]/u.test(remainder)) {
      title = remainder.replace(/^\s*[-:|]\s*/u, "");
    }
  }
  while (PRESENTATION_SUFFIX.test(title)) title = title.replace(PRESENTATION_SUFFIX, "").trim();

  // Bracket/dash presentation can differ, but every version/clean/remaster word stays in the key.
  title = title.replace(/[()[\]]/gu, " ").replace(/\s+[-|]\s+/gu, " ")
    .replace(/\s+/gu, " ").trim();
  if (!title) return undefined;
  return JSON.stringify([artist, title, recording.type]);
}
