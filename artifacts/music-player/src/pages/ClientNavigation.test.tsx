import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "@/App";
import { clearTfSessionSecurityState } from "@/lib/tf-session-client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
let capabilities: string[];
let spotifyConnected: boolean;
let spotifyUnavailable: boolean;
let spotifyNetworkError: boolean;
let spotifyGrantExpired: boolean;
let candidateFixture: boolean;
let candidateFailure: boolean;
let calls: { path: string; init?: RequestInit }[];
class FixtureAudio extends EventTarget {
  currentTime = 0;
  duration = 180;
  volume = 0.8;
  src = "";
  paused = true;
  pause() {
    this.paused = true;
  }
  load() {}
}

beforeEach(() => {
  clearTfSessionSecurityState();
  localStorage.clear();
  capabilities = ["tf.search", "tf.collections", "tf.integrations"];
  spotifyConnected = true;
  spotifyUnavailable = false;
  spotifyNetworkError = false;
  spotifyGrantExpired = false;
  candidateFixture = false;
  candidateFailure = false;
  calls = [];
  vi.stubGlobal("Audio", FixtureAudio);
  vi.stubGlobal(
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input), "https://tf.apollot.ru").pathname;
      calls.push({ path, init });
      if (path.endsWith("/auth/me")) {
        const response = json({
          accountId: "11111111-1111-4111-8111-111111111111",
          installationId: "22222222-2222-4222-8222-222222222222",
          entitlements: capabilities,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          csrfToken: "a".repeat(42) + "A",
        });
        response.headers.set("Apollo-TF-Session-Profile", "renewal-v1");
        return response;
      }
      if (path.endsWith("/spotify/status") && spotifyNetworkError)
        throw new TypeError("Fixture network error");
      if (path.endsWith("/spotify/status"))
        return spotifyUnavailable
          ? json({ error: "provider_unavailable" }, 503)
          : json({
              connected: spotifyConnected,
              displayName: spotifyConnected ? "Fixture Listener" : undefined,
            });
      if (path.endsWith("/yandex/status")) return json({ connected: false });
      if (path.endsWith("/spotify/logout")) {
        spotifyConnected = false;
        return json({ success: true });
      }
      if (path.endsWith("/collections/liked"))
        return json({ items: [], nextCursor: null });
      if (path.endsWith("/collections/liked/lookup"))
        return json({ likedTrackIds: [] });
      if (path.endsWith("/spotify/liked") && spotifyGrantExpired) {
        spotifyConnected = false;
        return json({ error: "not_connected" }, 401);
      }
      if (path.endsWith("/spotify/liked"))
        return json({
          tracks: [
            {
              id: "fixture-liked",
              title: "Saved Fixture Track",
              artist: "Fixture Artist",
              album: "Fixture Album",
              durationMs: 180000,
              thumbnailUrl: null,
              spotifyUrl: "https://open.spotify.com/track/fixture",
            },
          ],
          total: 1,
          offset: 0,
          limit: 50,
        });
      if (path.endsWith("/tracks/search"))
        return candidateFailure
          ? json({ error: "search_unavailable" }, 503)
          : candidateFixture
          ? json({ query: "Fixture Artist Saved Fixture Track", results: [{
              id: "yt_candidate", title: "Independent Recording", artist: "Fixture Artist",
              type: "original", duration: 180, source: "youtube", thumbnailUrl: null,
              quality: ["128"], viewCount: 10, score: 82,
            }], cached: false, sources: ["yt"], fallbackAvailable: false })
          : json({ results: [], cached: false, sources: ["yt"] });
      throw new Error(`Unexpected fixture request: ${path}`);
    },
  );
});
afterEach(() => {
  cleanup();
  clearTfSessionSecurityState();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});
async function open(path: string) {
  window.history.replaceState({}, "", path);
  render(<App />);
  await screen.findByRole("link", { name: "Поиск" });
}

it("navigates from Favorites to provider controls without putting disconnect controls in collection content", async () => {
  const user = userEvent.setup();
  await open("/favorites");
  await user.click(screen.getByRole("button", { name: "Spotify" }));
  await screen.findByText("Saved Fixture Track");
  expect(
    screen.queryByRole("button", { name: /disconnect|отключить/i }),
  ).toBeNull();
  await user.click(screen.getByRole("link", { name: "Подключения" }));
  expect(screen.getByRole("link", { name: "Подключения" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const spotify = await screen.findByRole("region", { name: "Spotify" });
  expect(within(spotify).getByText("Fixture Listener")).toBeInTheDocument();
  await user.click(
    within(spotify).getByRole("button", { name: "Отключить Spotify" }),
  );
  await waitFor(() =>
    expect(
      within(spotify).getByRole("link", { name: "Подключить Spotify" }),
    ).toBeInTheDocument(),
  );
  const logout = calls.find(({ path }) => path.endsWith("/spotify/logout"));
  expect(logout?.init?.method).toBe("POST");
  expect(logout?.init?.credentials).toBe("include");
  expect(new Headers(logout?.init?.headers).get("X-CSRF-Token")).toBe(
    "a".repeat(42) + "A",
  );
});

it("rechecks Spotify after invalid_grant without repeating the library request or losing the Apollo session", async () => {
  spotifyGrantExpired = true;
  const user = userEvent.setup();
  await open("/favorites");
  await user.click(screen.getByRole("button", { name: "Spotify" }));
  await waitFor(() =>
    expect(
      calls.filter(({ path }) => path.endsWith("/spotify/status")).length,
    ).toBeGreaterThanOrEqual(2),
  );
  expect(screen.getByRole("link", { name: "Подключения" })).toBeInTheDocument();
  await user.click(screen.getByRole("link", { name: "Подключения" }));
  const spotify = await screen.findByRole("region", { name: "Spotify" });
  expect(
    await within(spotify).findByRole("link", { name: "Подключить Spotify" }),
  ).toHaveAttribute("href", "/api/spotify/login");
  expect(within(spotify).queryByText("Fixture Listener")).toBeNull();
  expect(
    calls.filter(({ path }) => path.endsWith("/spotify/liked")),
  ).toHaveLength(1);
  expect(calls.filter(({ path }) => path.endsWith("/auth/me"))).toHaveLength(1);
  expect(calls.some(({ path }) => path.endsWith("/auth/logout"))).toBe(false);
});

it("keeps direct Integrations access locked without provider requests when capability is absent", async () => {
  capabilities = ["tf.search", "tf.collections"];
  await open("/integrations");
  expect(
    await screen.findByText(
      "Подключение музыкальных сервисов недоступно для этого аккаунта.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Подключить Spotify" })).toBeNull();
  expect(calls.filter(({ path }) => /\/(spotify|yandex)\//.test(path))).toEqual(
    [],
  );
});

it("renders a provider transport failure with retry, not disconnected or connected", async () => {
  spotifyNetworkError = true;
  await open("/integrations");
  const spotify = await screen.findByRole("region", { name: "Spotify" });
  expect(await within(spotify).findByRole("alert")).toHaveTextContent(
    "Не удалось проверить подключение",
  );
  expect(
    within(spotify).queryByRole("link", { name: "Подключить Spotify" }),
  ).toBeNull();
  spotifyNetworkError = false;
  await userEvent
    .setup()
    .click(
      within(spotify).getByRole("button", { name: "Проверить Spotify снова" }),
    );
  expect(
    await within(spotify).findByText("Fixture Listener"),
  ).toBeInTheDocument();
});

it("preserves the shared fail-closed boundary for a provider HTTP503 instead of bypassing auth", async () => {
  spotifyUnavailable = true;
  await open("/integrations");
  expect(
    await screen.findByRole("heading", { name: "Сервис временно недоступен" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Подключить Spotify" })).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Отключить Spotify" }),
  ).toBeNull();
});

it("shows existing Spotify login destination and truthful unavailable Yandex onboarding", async () => {
  spotifyConnected = false;
  await open("/integrations");
  const spotify = await screen.findByRole("region", { name: "Spotify" });
  expect(
    await within(spotify).findByRole("link", { name: "Подключить Spotify" }),
  ).toHaveAttribute("href", "/api/spotify/login");
  const yandex = screen.getByRole("region", { name: "Yandex Music" });
  expect(
    await within(yandex).findByText("Подключение временно недоступно"),
  ).toBeInTheDocument();
  expect(within(yandex).queryByRole("textbox")).toBeNull();
  expect(
    within(yandex).queryByRole("link", { name: /подключить/i }),
  ).toBeNull();
});

it("hands an old Favorites OAuth return to Integrations without treating query text as authority", async () => {
  spotifyConnected = false;
  await open("/favorites?spotify_connected=1&ignored=not-forwarded");
  await waitFor(() => expect(window.location.pathname).toBe("/integrations"));
  const spotify = await screen.findByRole("region", { name: "Spotify" });
  expect(
    await within(spotify).findByRole("link", { name: "Подключить Spotify" }),
  ).toBeInTheDocument();
  expect(window.location.search).toBe("");
});

it("keeps source selections and keyboard search submission in the compact Home form", async () => {
  const user = userEvent.setup();
  await open("/");
  await user.click(screen.getByRole("button", { name: "Точный" }));
  const artist = screen.getByRole("textbox", { name: "Исполнитель" });
  await user.click(artist);
  await user.type(artist, "Fixture Artist");
  await user.tab();
  await user.keyboard("Fixture Track");
  await user.click(screen.getByRole("checkbox", { name: "SoundCloud" }));
  await user.click(screen.getByRole("checkbox", { name: "Bandcamp" }));
  await user.click(screen.getByRole("checkbox", { name: "Deezer" }));
  await user.click(screen.getByRole("combobox", { name: "Название трека" }));
  await user.keyboard("{Enter}");
  await screen.findByText("No tracks found");
  const search = calls.find(({ path }) => path.endsWith("/tracks/search"));
  expect(JSON.parse(String(search?.init?.body))).toEqual({
    artist: "Fixture Artist",
    title: "Fixture Track",
    mode: "manual",
    sources: ["yt"],
  });
  expect(screen.getByRole("checkbox", { name: "YouTube" })).toBeChecked();
});

it("resolves a provider-library track in place into playable and savable TF candidates", async () => {
  candidateFixture = true;
  const user = userEvent.setup();
  await open("/favorites");
  await user.click(screen.getByRole("button", { name: "Spotify" }));
  await screen.findByText("Saved Fixture Track");
  await user.click(screen.getByRole("button", { name: "Найти в TF: Saved Fixture Track" }));
  expect(window.location.pathname).toBe("/favorites");
  expect(await screen.findByText("Independent Recording")).toBeInTheDocument();
  const search = calls.find(({ path }) => path.endsWith("/tracks/search"));
  expect(JSON.parse(String(search?.init?.body))).toEqual({
    artist: "Fixture Artist", title: "Saved Fixture Track", mode: "auto", maxResults: 6,
  });
  expect(screen.getByRole("button", { name: "Воспроизвести: Independent Recording" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Сохранить в избранное" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Yandex Music" }));
  expect(screen.queryByRole("region", { name: "Подбор записи TF" })).toBeNull();
});

it("keeps the provider library visible when candidate search fails and allows retry", async () => {
  candidateFixture = true;
  candidateFailure = true;
  const user = userEvent.setup();
  await open("/favorites");
  await user.click(screen.getByRole("button", { name: "Spotify" }));
  await user.click(await screen.findByRole("button", { name: "Найти в TF: Saved Fixture Track" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Поиск сейчас недоступен");
  expect(screen.getByText("Saved Fixture Track")).toBeInTheDocument();
  candidateFailure = false;
  await user.click(screen.getByRole("button", { name: "Повторить" }));
  expect(await screen.findByText("Independent Recording")).toBeInTheDocument();
});
