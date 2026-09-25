export type RecentSearch =
  | { kind: "quick"; query: string; savedAt: number }
  | { kind: "exact"; artist: string; title: string; savedAt: number };

type SearchInput =
  | { kind: "quick"; query: string }
  | { kind: "exact"; artist: string; title: string };

interface SearchIdentity {
  readonly accountId: string;
  readonly installationId: string;
}

const VERSION = 1;
const MAX_ENTRIES = 8;
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;

function storageKey(identity: SearchIdentity): string {
  return `tf_recent_searches:v${VERSION}:${identity.accountId}:${identity.installationId}`;
}

function validateEntry(value: unknown, now: number): RecentSearch | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.savedAt !== "number" ||
    !Number.isFinite(item.savedAt) ||
    item.savedAt > now ||
    item.savedAt < now - MAX_AGE_MS
  )
    return null;
  if (item.kind === "quick" && typeof item.query === "string") {
    const query = item.query.trim();
    return query.length >= 2 && query.length <= 500
      ? { kind: "quick", query, savedAt: item.savedAt }
      : null;
  }
  if (
    item.kind === "exact" &&
    typeof item.artist === "string" &&
    typeof item.title === "string"
  ) {
    const artist = item.artist.trim();
    const title = item.title.trim();
    return artist.length > 0 &&
      artist.length <= 200 &&
      title.length > 0 &&
      title.length <= 300
      ? { kind: "exact", artist, title, savedAt: item.savedAt }
      : null;
  }
  return null;
}

function fingerprint(entry: SearchInput): string {
  return entry.kind === "quick"
    ? `q:${entry.query.toLowerCase()}`
    : `e:${entry.artist.toLowerCase()}\u0000${entry.title.toLowerCase()}`;
}

export function readRecentSearches(
  identity: SearchIdentity,
  now = Date.now(),
  storage?: Storage,
): RecentSearch[] {
  try {
    const target = storage ?? window.localStorage;
    const key = storageKey(identity);
    const raw = target.getItem(key);
    if (raw === null) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      target.removeItem(key);
      return [];
    }
    if (!Array.isArray(parsed)) {
      target.removeItem(key);
      return [];
    }
    const seen = new Set<string>();
    const entries = parsed
      .map((value) => validateEntry(value, now))
      .filter((entry): entry is RecentSearch => entry !== null)
      .sort((a, b) => b.savedAt - a.savedAt)
      .filter((entry) => {
        const key = fingerprint(entry);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_ENTRIES);
    if (JSON.stringify(entries) !== JSON.stringify(parsed)) {
      try {
        if (entries.length === 0) target.removeItem(key);
        else target.setItem(key, JSON.stringify(entries));
      } catch {
        // Display the sanitized entries even when storage writes are blocked.
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function writeRecentSearches(
  identity: SearchIdentity,
  entries: readonly RecentSearch[],
  storage?: Storage,
): void {
  try {
    (storage ?? window.localStorage).setItem(
      storageKey(identity),
      JSON.stringify(entries),
    );
  } catch {
    // Browser storage may be disabled; the current view can still use the returned entries.
  }
}

export function rememberRecentSearch(
  identity: SearchIdentity,
  input: SearchInput,
  now = Date.now(),
  storage?: Storage,
): RecentSearch[] {
  const entry = validateEntry({ ...input, savedAt: now }, now);
  if (!entry) return readRecentSearches(identity, now, storage);
  const key = fingerprint(entry);
  const entries = [
    entry,
    ...readRecentSearches(identity, now, storage).filter(
      (item) => fingerprint(item) !== key,
    ),
  ].slice(0, MAX_ENTRIES);
  writeRecentSearches(identity, entries, storage);
  return entries;
}

export function removeRecentSearch(
  identity: SearchIdentity,
  entry: RecentSearch,
  now = Date.now(),
  storage?: Storage,
): RecentSearch[] {
  const key = fingerprint(entry);
  const entries = readRecentSearches(identity, now, storage).filter(
    (item) => fingerprint(item) !== key,
  );
  writeRecentSearches(identity, entries, storage);
  return entries;
}

export function clearRecentSearches(
  identity: SearchIdentity,
  storage?: Storage,
): void {
  try {
    (storage ?? window.localStorage).removeItem(storageKey(identity));
  } catch {
    // The current view clears regardless of storage availability.
  }
}
