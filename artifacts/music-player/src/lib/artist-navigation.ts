const MAX_ARTIST_LENGTH = 200;
const INVALID_ARTIST_CHARACTER = /[\p{Cc}\p{Cs}\p{Bidi_Control}\u2028\u2029]/u;

function normalizeArtistName(value: string): string | null {
  if (value.length > MAX_ARTIST_LENGTH || INVALID_ARTIST_CHARACTER.test(value)) return null;
  const name = value.trim().replace(/\s+/gu, " ").normalize("NFC");
  return name && name.length <= MAX_ARTIST_LENGTH ? name : null;
}

export function artistHref(artist: string): string | null {
  const name = normalizeArtistName(artist);
  return name === null ? null : `/artist?name=${encodeURIComponent(name)}`;
}

export function readArtistName(search: string): string | null {
  const query = search.startsWith("?") ? search.slice(1) : search;
  if (!query || query.length > 2_048 || query.startsWith("?") || /[&#]/.test(query) || INVALID_ARTIST_CHARACTER.test(query)) {
    return null;
  }
  try {
    // URLSearchParams repairs invalid percent-encoded UTF-8 instead of rejecting it.
    decodeURIComponent(query);
  } catch {
    return null;
  }
  const name = new URLSearchParams(query).get("name");
  return name === null ? null : normalizeArtistName(name);
}
