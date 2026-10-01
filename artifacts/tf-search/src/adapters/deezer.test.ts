import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Adapter = typeof import("./deezer.js");
let adapter: Adapter;
const fetchFixture = vi.fn<typeof fetch>();

function track(overrides: Record<string, unknown> = {}) {
  return {
    id: 123,
    title: "Fixture Song",
    title_short: "Fixture Song",
    title_version: "",
    duration: 232,
    artist: { id: 456, name: "Fixture Artist" },
    album: { cover_medium: "https://cdn-images.dzcdn.net/cover.jpg" },
    preview: "https://cdnt-preview.dzcdn.net/api/1/1/fixture.mp3",
    rank: 100,
    ...overrides,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetModules();
  fetchFixture.mockReset().mockImplementation(async () => {
    throw new Error("unconfigured_http_fixture");
  });
  vi.stubGlobal("fetch", fetchFixture);
  adapter = await import("./deezer.js");
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("preserves version metadata in media titles rather than admitting a live version as original", async () => {
  fetchFixture.mockResolvedValueOnce(json({ data: [track({ title_version: "(Live)" })] }));

  expect(await adapter.searchDeezer("Fixture Artist Fixture Song", 10)).toEqual([
    expect.objectContaining({ title: "Fixture Song (Live)", type: "live", duration: 232 }),
  ]);
});

it("returns catalog references independently of absent or unusable previews", async () => {
  fetchFixture.mockResolvedValueOnce(json({ data: [
    track({ preview: null }),
    track({ id: 124, title_version: "(Live)", preview: "not a URL" }),
    track({ id: 125, title: "Short Song", duration: 42, preview: undefined, album: null }),
  ] }));

  expect(await adapter.searchDeezerCatalog("Fixture Artist", 10)).toEqual([
    { artist: "Fixture Artist", title: "Fixture Song", type: "original", duration: 232 },
    { artist: "Fixture Artist", title: "Fixture Song (Live)", type: "live", duration: 232 },
    { artist: "Fixture Artist", title: "Short Song", type: "original", duration: 42 },
  ]);
  expect(await adapter.searchDeezer("Fixture Artist", 10)).toEqual([]);
  expect(fetchFixture).toHaveBeenCalledOnce();
});

it("deduplicates only explicit matching trailing version qualifiers", async () => {
  fetchFixture.mockResolvedValueOnce(json({ data: [
    track({ title: "Fixture Song (LIVE)", title_version: "(Live)" }),
    track({ id: 124, title: "Fixture Song - Live", title_version: "(Live)" }),
    track({ id: 125, title: "Lively Song", title_version: "Live" }),
    track({ id: 126, title: "Live Forever", title_version: "(Live)" }),
    track({ id: 127, title: "Fixture Song [LiVe]", title_version: "(Live)" }),
    track({ id: 128, title: "Long Live", title_version: "(Live)" }),
    track({ id: 129, title: "Fixture (Live) Song", title_version: "(Live)" }),
    track({ id: 130, title: "Fixture Song (Live at Wembley)", title_version: "(Live)" }),
  ] }));

  expect(await adapter.searchDeezerCatalog("versions", 10)).toEqual([
    { artist: "Fixture Artist", title: "Fixture Song (LIVE)", type: "live", duration: 232 },
    { artist: "Fixture Artist", title: "Fixture Song - Live", type: "live", duration: 232 },
    { artist: "Fixture Artist", title: "Lively Song Live", type: "live", duration: 232 },
    { artist: "Fixture Artist", title: "Live Forever (Live)", type: "live", duration: 232 },
    { artist: "Fixture Artist", title: "Fixture Song [LiVe]", type: "live", duration: 232 },
    { artist: "Fixture Artist", title: "Long Live (Live)", type: "live", duration: 232 },
    { artist: "Fixture Artist", title: "Fixture (Live) Song (Live)", type: "live", duration: 232 },
    { artist: "Fixture Artist", title: "Fixture Song (Live at Wembley) (Live)", type: "live", duration: 232 },
  ]);
});

it("skips invalid metadata without losing valid references or depending on album and preview fields", async () => {
  fetchFixture.mockResolvedValueOnce(json({ data: [
    track({ id: 0 }), track({ id: "123" }), track({ id: 1.5 }),
    track({ title: "  " }), track({ artist: { name: " " } }), track({ artist: null }),
    track({ duration: 0 }), track({ duration: -1 }), track({ duration: "232" }),
    track({ duration: 232.5 }), track({ duration: 86_401 }),
    track({ title: "t".repeat(501) }), track({ artist: { name: "a".repeat(301) } }),
    track({ title_version: "v".repeat(501) }), track({ title: "t".repeat(495), title_version: "Remix" }),
    track({ title_version: { unknown: "Live" } }), null,
    track({ id: 130, title: "  Fixture Song  ", artist: { name: " Fixture Artist " }, preview: 1, album: "invalid" }),
    track({ id: 131, title: `${"t".repeat(493)} (Live)`, title_version: "(Live)", artist: { name: "a".repeat(300) }, duration: 86_400 }),
    track({ id: 132, title: "t".repeat(494), title_version: "Remix", duration: 1 }),
  ] }));

  expect(await adapter.searchDeezerCatalog("metadata", 25)).toEqual([
    { artist: "Fixture Artist", title: "Fixture Song", type: "original", duration: 232 },
    { artist: "a".repeat(300), title: `${"t".repeat(493)} (Live)`, type: "live", duration: 86_400 },
    { artist: "Fixture Artist", title: `${"t".repeat(494)} Remix`, type: "remix", duration: 1 },
  ]);
  expect(await adapter.searchDeezer("metadata", 25)).toHaveLength(2);
  expect(fetchFixture).toHaveBeenCalledOnce();
});

it("keeps the existing media DTO and rejects non-provider or unusable preview URLs", async () => {
  fetchFixture.mockResolvedValueOnce(json({ data: [
    ...[
      "", "not a URL", "http://cdnt-preview.dzcdn.net/a.mp3", "javascript:alert(1)",
      "https://localhost/a.mp3", "https://dzcdn.net.evil.test/a.mp3",
      "https://user:password@cdnt-preview.dzcdn.net/a.mp3", "https://cdnt-preview.dzcdn.net:8443/a.mp3",
      `https://cdnt-preview.dzcdn.net/${"p".repeat(4_096)}`,
      `https://cdnt-preview.dzcdn.net/${"p".repeat(3_100)}`,
    ].map((preview, index) => track({ id: index + 1, preview })),
    track(),
    track({ id: 124, rank: 1.5, album: { cover_medium: "http://cdn-images.dzcdn.net/cover.jpg" } }),
    track({ id: 125, rank: Number.MAX_SAFE_INTEGER + 1, album: { cover_medium: "javascript:alert(1)" } }),
    track({ id: 126, rank: Number.MAX_SAFE_INTEGER, album: { cover_medium: null } }),
    track({ id: 127, rank: undefined, album: { cover_medium: "not a URL" } }),
  ] }));

  expect(await adapter.searchDeezer("media", 25)).toEqual([{
    id: "dz_aHR0cHM6Ly9jZG50LXByZXZpZXcuZHpjZG4ubmV0L2FwaS8xLzEvZml4dHVyZS5tcDM",
    title: "Fixture Song", artist: "Fixture Artist", type: "original", duration: 232,
    source: "deezer", thumbnailUrl: "https://cdn-images.dzcdn.net/cover.jpg",
    quality: ["128"], viewCount: 100, score: 0,
    sourceUrl: "https://cdnt-preview.dzcdn.net/api/1/1/fixture.mp3",
  }, ...[null, null, Number.MAX_SAFE_INTEGER, null].map((viewCount) => ({
    id: "dz_aHR0cHM6Ly9jZG50LXByZXZpZXcuZHpjZG4ubmV0L2FwaS8xLzEvZml4dHVyZS5tcDM",
    title: "Fixture Song", artist: "Fixture Artist", type: "original", duration: 232,
    source: "deezer", thumbnailUrl: null, quality: ["128"], viewCount, score: 0,
    sourceUrl: "https://cdnt-preview.dzcdn.net/api/1/1/fixture.mp3",
  }))]);
});

it("uses the fixed HTTPS endpoint with encoded original query, a bounded limit and the existing timeout", async () => {
  const timeout = vi.spyOn(AbortSignal, "timeout");
  fetchFixture.mockResolvedValueOnce(json({ data: Array.from({ length: 30 }, (_, index) => track({ id: index + 1 })) }));

  expect(await adapter.searchDeezerCatalog("  artist & title? https://evil.test/  ", 100)).toHaveLength(25);
  const [input, init] = fetchFixture.mock.calls[0]!;
  const url = new URL(String(input));
  expect(url.origin).toBe("https://api.deezer.com");
  expect(url.pathname).toBe("/search");
  expect(url.searchParams.get("q")).toBe("  artist & title? https://evil.test/  ");
  expect(url.searchParams.get("limit")).toBe("25");
  expect(url.searchParams.get("output")).toBe("json");
  expect(init?.headers).toEqual({ Accept: "application/json" });
  expect(init?.redirect).toBe("error");
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(timeout).toHaveBeenCalledWith(8_000);
});

it("enforces the requested smaller budget even if the API overreturns entries", async () => {
  fetchFixture.mockResolvedValueOnce(json({ data: [track(), track({ id: 124 }), track({ id: 125 })] }));
  expect(await adapter.searchDeezerCatalog("small budget", 2)).toHaveLength(2);
});

it("does not fetch for empty queries or unusable result budgets", async () => {
  expect(await adapter.searchDeezerCatalog(" ", 10)).toEqual([]);
  for (const limit of [0, -1, Number.NaN]) {
    expect(await adapter.searchDeezerCatalog("query", limit)).toEqual([]);
  }
  expect(fetchFixture).not.toHaveBeenCalled();
});

it("shares a single in-flight public response between catalog and media callers with the same query and limit", async () => {
  const pending = pendingResponse();
  fetchFixture.mockReturnValueOnce(pending.promise);
  const catalog = adapter.searchDeezerCatalog("same query", 10);
  const media = adapter.searchDeezer("same query", 10);
  pending.resolve(json({ data: [track()] }));

  expect(await catalog).toEqual([
    { artist: "Fixture Artist", title: "Fixture Song", type: "original", duration: 232 },
  ]);
  expect(await media).toHaveLength(1);
  expect(fetchFixture).toHaveBeenCalledOnce();
});

it("keeps query and result-budget cache identities distinct", async () => {
  fetchFixture.mockImplementation(async () => json({ data: [track()] }));
  await adapter.searchDeezerCatalog("query", 1);
  await adapter.searchDeezerCatalog("query", 2);
  await adapter.searchDeezerCatalog("other query", 1);
  await adapter.searchDeezer("query", 1);
  expect(fetchFixture).toHaveBeenCalledTimes(3);
});

it("expires successful shared responses after five minutes without sliding the expiry on cache hits", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  fetchFixture.mockImplementation(async () => json({ data: [track()] }));
  await adapter.searchDeezerCatalog("cached", 10);
  vi.setSystemTime(299_999);
  await adapter.searchDeezer("cached", 10);
  expect(fetchFixture).toHaveBeenCalledOnce();
  vi.setSystemTime(300_000);
  await adapter.searchDeezerCatalog("cached", 10);
  expect(fetchFixture).toHaveBeenCalledTimes(2);
});

it("evicts the least recently used response when the shared cache reaches 256 entries", async () => {
  fetchFixture.mockImplementation(async () => json({ data: [track()] }));
  for (let index = 0; index < 256; index += 1) {
    await adapter.searchDeezerCatalog(`query ${index}`, 1);
  }
  await adapter.searchDeezer("query 0", 1);
  await adapter.searchDeezerCatalog("query 256", 1);
  await adapter.searchDeezerCatalog("query 0", 1);
  expect(fetchFixture).toHaveBeenCalledTimes(257);
  await adapter.searchDeezerCatalog("query 1", 1);
  expect(fetchFixture).toHaveBeenCalledTimes(258);
});

it.each([
  ["HTTP failure", () => Promise.resolve(json({ error: "unavailable" }, 503))],
  ["API error body", () => Promise.resolve(json({ data: [], error: { type: "Exception", code: 4, message: "private_detail" } }))],
  ["malformed envelope", () => Promise.resolve(json({ data: "not an array" }))],
  ["invalid JSON", () => Promise.resolve(new Response("not JSON"))],
  ["transport failure", () => Promise.reject(new TypeError("network failed"))],
] as const)("does not cache %s and releases the pending slot for a subsequent retry", async (_name, fail) => {
  fetchFixture.mockImplementationOnce(fail).mockResolvedValueOnce(json({ data: [track()] }));
  await expect(adapter.searchDeezerCatalog("retry", 10)).rejects.toThrow();
  expect(await adapter.searchDeezer("retry", 10)).toHaveLength(1);
  expect(fetchFixture).toHaveBeenCalledTimes(2);
});

it("caps distinct in-flight operations at 16 while still sharing existing work and releasing settled slots", async () => {
  const pending = Array.from({ length: 16 }, () => pendingResponse());
  let index = 0;
  fetchFixture.mockImplementation(() => pending[index++]!.promise);
  const requests = pending.map((_, query) => adapter.searchDeezerCatalog(`pending ${query}`, 10));
  const duplicate = adapter.searchDeezer("pending 0", 10);
  await expect(adapter.searchDeezerCatalog("overflow", 10)).rejects.toThrow("deezer_search_busy");
  expect(fetchFixture).toHaveBeenCalledTimes(16);
  pending.forEach((item) => item.resolve(json({ data: [track()] })));
  expect(await Promise.all(requests)).toHaveLength(16);
  expect(await duplicate).toHaveLength(1);
  fetchFixture.mockResolvedValueOnce(json({ data: [track()] }));
  expect(await adapter.searchDeezerCatalog("overflow", 10)).toHaveLength(1);
  expect(fetchFixture).toHaveBeenCalledTimes(17);
});
