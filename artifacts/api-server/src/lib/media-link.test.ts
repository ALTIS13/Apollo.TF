import { expect, it, vi } from "vitest";
import {
  MediaLinkResolutionError,
  resolvePastedMediaLink,
  type MediaLinkYtDlpOptions,
} from "./media-link.js";

const videoId = "AbCdEfGhI12";
const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
const bandcampUrl = "https://artist.bandcamp.com/track/a-song";

const json = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "content-type": "application/json", ...headers },
});

const youtubeMetadata = {
  extractor_key: "Youtube",
  id: videoId,
  webpage_url: youtubeUrl,
  title: "  A\nSong  ",
  uploader: "  An Artist  ",
  duration: 211.4,
};

it.each([
  youtubeUrl,
  `https://youtube.com/shorts/${videoId}`,
  `https://music.youtube.com/watch?v=${videoId}`,
  `https://youtu.be/${videoId}`,
])("resolves a YouTube track through its reconstructed canonical URL: %s", async (input) => {
  const runYtDlp = vi.fn(async (_args: readonly string[], _options: MediaLinkYtDlpOptions) => JSON.stringify(youtubeMetadata));
  const result = await resolvePastedMediaLink(input, { runYtDlp });

  expect(result).toEqual({
    schemaVersion: 1, source: "youtube", title: "A Song", artist: "An Artist", durationSeconds: 211,
  });
  const [args, options] = runYtDlp.mock.calls[0]!;
  expect(args).toEqual(expect.arrayContaining([
    "--dump-single-json", "--skip-download", "--no-playlist", "--ignore-config",
  ]));
  expect(args.at(-2)).toBe("--");
  expect(args.at(-1)).toBe(youtubeUrl);
  expect(options.timeoutMs).toBeLessThanOrEqual(10_000);
  expect(options.maxOutputBytes).toBeLessThanOrEqual(256 * 1024);
  expect(options.signal).toBeInstanceOf(AbortSignal);
});

it.each([
  `https://www.youtube.com/watch?v=${videoId}&si=Ab12_-`,
  `https://music.youtube.com/watch?si=Ab12_-&v=${videoId}&t=1m30s`,
  `https://youtu.be/${videoId}?si=Ab12_-&t=90`,
  `https://youtube.com/shorts/${videoId}?t=45s`,
])("strips bounded YouTube share and time parameters before resolution: %s", async (input) => {
  const runYtDlp = vi.fn(async (_args: readonly string[], _options: MediaLinkYtDlpOptions) => JSON.stringify(youtubeMetadata));
  expect(await resolvePastedMediaLink(input, { runYtDlp })).toMatchObject({ source: "youtube", title: "A Song" });
  expect(runYtDlp.mock.calls[0]![0].at(-1)).toBe(youtubeUrl);
});

it("resolves one Bandcamp track and verifies extractor and page identity", async () => {
  const runYtDlp = vi.fn(async (_args: readonly string[], _options: MediaLinkYtDlpOptions) => JSON.stringify({
    extractor_key: "Bandcamp",
    id: "12345",
    webpage_url: bandcampUrl,
    title: "A Song",
    artist: "Artist",
    duration: 180,
  }));
  expect(await resolvePastedMediaLink(bandcampUrl, { runYtDlp })).toEqual({
    schemaVersion: 1, source: "bandcamp", title: "A Song", artist: "Artist", durationSeconds: 180,
  });
  expect(runYtDlp.mock.calls[0]![0].at(-1)).toBe(bandcampUrl);
});

it("queries only the fixed SoundCloud oEmbed endpoint for a track", async () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => json({
    type: "rich",
    provider_name: "SoundCloud",
    provider_url: "https://soundcloud.com",
    title: " Track Title ",
    author_name: " Artist ",
    html: '<iframe src="https://w.soundcloud.com/player/?url=http%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F293"></iframe>',
  }));
  const result = await resolvePastedMediaLink("https://soundcloud.com/artist/track-title", { fetch: fetchMock });

  expect(result).toEqual({ schemaVersion: 1, source: "soundcloud", title: "Track Title", artist: "Artist" });
  const [requestUrl, options] = fetchMock.mock.calls[0]!;
  const endpoint = new URL(String(requestUrl));
  expect(endpoint.origin).toBe("https://soundcloud.com");
  expect(endpoint.pathname).toBe("/oembed");
  expect(endpoint.searchParams.get("url")).toBe("https://soundcloud.com/artist/track-title");
  expect(options?.redirect).toBe("error");
  expect(options?.signal).toBeInstanceOf(AbortSignal);
});

it("removes SoundCloud oEmbed's duplicate author suffix before exact search", async () => {
  const fetchMock = vi.fn(async () => json({
    type: "rich",
    provider_name: "SoundCloud",
    provider_url: "https://soundcloud.com",
    title: "Flickermood by Forss",
    author_name: "Forss",
    html: '<iframe src="https://w.soundcloud.com/player/?url=http%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F293"></iframe>',
  }));
  expect(await resolvePastedMediaLink("https://soundcloud.com/forss/flickermood", { fetch: fetchMock }))
    .toMatchObject({ title: "Flickermood", artist: "Forss" });
});

it("queries only the fixed Deezer track API and does not expose its preview", async () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => json({
    id: 123,
    title: "  Album Track ",
    duration: 205,
    artist: { name: "Singer" },
    preview: "https://cdns-preview.dzcdn.net/stream/preview.mp3",
  }));
  const result = await resolvePastedMediaLink("https://www.deezer.com/en/track/123", { fetch: fetchMock });

  expect(result).toEqual({
    schemaVersion: 1, source: "deezer", title: "Album Track", artist: "Singer", durationSeconds: 205,
  });
  expect(fetchMock.mock.calls[0]![0]).toBe("https://api.deezer.com/track/123");
  expect(fetchMock.mock.calls[0]![1]?.redirect).toBe("error");
  expect(JSON.stringify(result)).not.toContain("preview");
});

it.each([
  "http://youtube.com/watch?v=AbCdEfGhI12",
  "https://user@youtube.com/watch?v=AbCdEfGhI12",
  "https://youtube.com:443/watch?v=AbCdEfGhI12",
  "https://youtube.com/watch?v=AbCdEfGhI12#start",
  "https://youtube.com/watch?v=AbCdEfGhI12#",
  "https://youtube.com/watch?v=AbCdEfGhI12&list=playlist",
  "https://youtube.com/watch?v=AbCdEfGhI12&feature=share",
  "https://youtube.com/watch?v=AbCdEfGhI12&si=one&si=two",
  "https://youtube.com/watch?v=AbCdEfGhI12&v=AbCdEfGhI12",
  "https://youtube.com/watch?v=AbCdEfGhI12&t=-1",
  "https://youtu.be/AbCdEfGhI12?si=",
  "https://youtu.be/AbCdEfGhI12?v=AbCdEfGhI12",
  "https://youtube.com/playlist?list=playlist",
  "https://youtube.com.evil.example/watch?v=AbCdEfGhI12",
  "https://youtube.com/redirect?url=https://private.invalid",
  "https://soundcloud.com/artist/sets/album",
  "https://soundcloud.com/artist/likes",
  "https://artist.bandcamp.com/album/record",
  "https://deezer.com/track/0",
  "https://api.deezer.com/track/123",
  "https://spotify.com/track/123",
  "https://music.yandex.ru/album/1/track/2",
  "https://127.0.0.1/private",
  "https://youtube.com/%2e%2e/watch?v=AbCdEfGhI12",
])("rejects unsupported or hostile links before provider I/O: %s", async (input) => {
  const fetchMock = vi.fn(async () => json({}));
  const runYtDlp = vi.fn(async () => "{}");

  await expect(resolvePastedMediaLink(input, { fetch: fetchMock, runYtDlp })).rejects.toMatchObject({
    code: "unsupported_media_link",
  });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(runYtDlp).not.toHaveBeenCalled();
});

it.each([
  { extractor_key: "Bandcamp", id: videoId, webpage_url: youtubeUrl, title: "Wrong provider" },
  { extractor_key: "Youtube", id: "Different01", webpage_url: youtubeUrl, title: "Wrong ID" },
  { extractor_key: "Youtube", id: videoId, webpage_url: "https://evil.example/track", title: "Wrong page" },
])("rejects mismatched YouTube metadata", async (metadata) => {
  await expect(resolvePastedMediaLink(youtubeUrl, {
    runYtDlp: async () => JSON.stringify(metadata),
  })).rejects.toMatchObject({ code: "media_link_unavailable" });
});

it("rejects a mismatched Bandcamp page", async () => {
  await expect(resolvePastedMediaLink(bandcampUrl, {
    runYtDlp: async () => JSON.stringify({
      extractor_key: "Bandcamp", id: "12345", webpage_url: "https://other.bandcamp.com/track/a-song", title: "Song",
    }),
  })).rejects.toMatchObject({ code: "media_link_unavailable" });
});

it.each([
  { provider_name: "Other", provider_url: "https://soundcloud.com", type: "rich", title: "Song" },
  { provider_name: "SoundCloud", provider_url: "https://soundcloud.com", type: "rich", title: "Song", html: '<iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Fplaylists%2F293"></iframe>' },
])("rejects SoundCloud provider or track-type mismatch", async (metadata) => {
  await expect(resolvePastedMediaLink("https://soundcloud.com/artist/track", {
    fetch: vi.fn(async () => json(metadata)),
  })).rejects.toMatchObject({ code: "media_link_unavailable" });
});

it("rejects mismatched Deezer identity", async () => {
  await expect(resolvePastedMediaLink("https://deezer.com/track/123", {
    fetch: vi.fn(async () => json({ id: 124, title: "Song", artist: { name: "Artist" } })),
  })).rejects.toMatchObject({ code: "media_link_unavailable" });
});

it("fails closed on provider redirects and oversized metadata", async () => {
  const redirect = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe("error");
    throw new TypeError("redirect refused");
  });
  await expect(resolvePastedMediaLink("https://deezer.com/track/123", { fetch: redirect })).rejects.toMatchObject({
    code: "media_link_unavailable",
  });

  const redirected = json({ id: 123, title: "Song" });
  Object.defineProperty(redirected, "redirected", { value: true });
  await expect(resolvePastedMediaLink("https://deezer.com/track/123", {
    fetch: vi.fn(async () => redirected),
  })).rejects.toMatchObject({ code: "media_link_unavailable" });

  const oversized = vi.fn(async () => json({ id: 123 }, { "content-length": "999999" }));
  await expect(resolvePastedMediaLink("https://deezer.com/track/123", { fetch: oversized })).rejects.toMatchObject({
    code: "media_link_unavailable",
  });
  await expect(resolvePastedMediaLink(youtubeUrl, {
    runYtDlp: async () => "x".repeat(256 * 1024 + 1),
  })).rejects.toMatchObject({ code: "media_link_unavailable" });
  await expect(resolvePastedMediaLink("https://deezer.com/track/123", {
    fetch: vi.fn(async () => json({ padding: "x".repeat(64 * 1024) })),
  })).rejects.toMatchObject({ code: "media_link_unavailable" });
});

it("omits a blank optional artist without losing valid track metadata", async () => {
  expect(await resolvePastedMediaLink(youtubeUrl, {
    runYtDlp: async () => JSON.stringify({ ...youtubeMetadata, uploader: " \n " }),
  })).toEqual({ schemaVersion: 1, source: "youtube", title: "A Song", durationSeconds: 211 });
});

it("rejects metadata titles that cannot fit the search contract", async () => {
  const error = await resolvePastedMediaLink(youtubeUrl, {
    runYtDlp: async () => JSON.stringify({ ...youtubeMetadata, title: "T".repeat(301) }),
  }).catch((value: unknown) => value);
  expect(error).toBeInstanceOf(MediaLinkResolutionError);
  expect(error).toMatchObject({ code: "media_link_unavailable" });
});
