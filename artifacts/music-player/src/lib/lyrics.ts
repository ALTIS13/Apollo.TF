export interface SyncedLyricLine {
  time: number;
  text: string;
}

const TIMESTAMP = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

export function parseSyncedLyrics(value: string | null | undefined): SyncedLyricLine[] {
  if (!value) return [];

  const lines: SyncedLyricLine[] = [];
  for (const raw of value.split(/\r?\n/)) {
    const timestamps = [...raw.matchAll(TIMESTAMP)];
    const text = raw.replace(TIMESTAMP, "").trim();
    if (!text) continue;
    for (const match of timestamps) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      if (seconds >= 60) continue;
      const milliseconds = Number((match[3] ?? "0").padEnd(3, "0"));
      lines.push({ time: minutes * 60 + seconds + milliseconds / 1000, text });
      if (lines.length >= 500) break;
    }
    if (lines.length >= 500) break;
  }
  return lines.sort((a, b) => a.time - b.time);
}
