export type SourceKey = "yt" | "sc" | "bc" | "dz";
export type SourceMode = "auto" | "manual";

type SourcePrefs = { mode: SourceMode; sources: Record<SourceKey, boolean> };

const SOURCE_KEYS = ["yt", "sc", "bc", "dz"] as const;
const STORAGE_KEY = "tf_source_prefs";

function defaultPrefs(): SourcePrefs {
  return { mode: "auto", sources: { yt: true, sc: true, bc: true, dz: true } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSourcePrefs(value: unknown): SourcePrefs {
  if (!isRecord(value) || (value.mode !== "auto" && value.mode !== "manual")) {
    return defaultPrefs();
  }
  const savedSources = value.sources;
  if (
    !isRecord(savedSources) ||
    Object.keys(savedSources).length !== SOURCE_KEYS.length
  ) {
    return defaultPrefs();
  }
  const sources = {} as Record<SourceKey, boolean>;
  for (const key of SOURCE_KEYS) {
    const enabled = savedSources[key];
    if (typeof enabled !== "boolean") return defaultPrefs();
    sources[key] = enabled;
  }
  if (!SOURCE_KEYS.some((key) => sources[key])) return defaultPrefs();
  if (value.mode === "auto" && !SOURCE_KEYS.every((key) => sources[key]))
    return defaultPrefs();
  return { mode: value.mode, sources };
}

export function loadSourcePrefs(): SourcePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) return normalizeSourcePrefs(JSON.parse(raw));
  } catch {
    // Storage access and parsing can fail; keep the current session usable.
  }
  return defaultPrefs();
}

export function saveSourcePrefs(
  mode: SourceMode,
  sources: Record<SourceKey, boolean>,
): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, sources }));
  } catch {
    // The in-memory choice still applies when browser storage is blocked.
  }
}
