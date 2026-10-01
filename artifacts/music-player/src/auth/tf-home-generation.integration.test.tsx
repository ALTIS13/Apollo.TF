import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Home from "@/pages/Home";
import { PlayerProvider } from "@/hooks/use-player";
import { clearTfSessionSecurityState } from "@/lib/tf-session-client";
import { TfAuthProvider, useTfAuth, type TfAuthContextValue } from "./tf-auth";
import { TfSessionBoundary } from "./TfSessionBoundary";

const A = "11111111-1111-4111-8111-111111111111";
const B = "33333333-3333-4333-8333-333333333333";
let identity: string;
let auth: TfAuthContextValue;
let finishSearch: (response: Response) => void;
let searchStarted: boolean;
let searchBody: unknown;
let searchPath: string;
let linkBody: unknown;
let linkResponse: Response;
let holdLink: boolean;
let finishLink: (response: Response) => void;
let suggestionStarted: boolean;
let holdSuggestion: boolean;
let finishSuggestion: (response: Response) => void;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function Controls() {
  auth = useTfAuth();
  return (
    <span data-testid="account">
      {auth.status}:{auth.session?.accountId}
    </span>
  );
}
class ControlledAudio extends EventTarget {
  currentTime = 0;
  duration = 500;
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
  localStorage.removeItem("tf_source_prefs");
  identity = A;
  searchStarted = false;
  searchBody = null;
  searchPath = "";
  linkBody = null;
  linkResponse = json({ schemaVersion: 1, source: "soundcloud", artist: "Artist", title: "Track", durationSeconds: 180 });
  holdLink = false;
  suggestionStarted = false;
  holdSuggestion = false;
  vi.stubGlobal("Audio", ControlledAudio);
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = new URL(url, "https://tf.apollot.ru").pathname;
    if (path.endsWith("/auth/me")) {
      const response = json({
        accountId: identity,
        installationId: "22222222-2222-4222-8222-222222222222",
        entitlements: ["tf.search", "tf.collections"],
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        csrfToken: "a".repeat(42) + "A",
      });
      response.headers.set("Apollo-TF-Session-Profile", "renewal-v1");
      return response;
    }
    if (path.endsWith("/search") || path.endsWith("/free-search")) {
      searchStarted = true;
      searchPath = path;
      searchBody = JSON.parse(String(init?.body));
      return new Promise<Response>((resolve) => {
        finishSearch = resolve;
      });
    }
    if (path.endsWith("/link-metadata")) {
      linkBody = JSON.parse(String(init?.body));
      if (holdLink) return new Promise<Response>((resolve) => { finishLink = resolve; });
      return linkResponse;
    }
    if (path.endsWith("/suggest")) {
      suggestionStarted = true;
      if (holdSuggestion) {
        return new Promise<Response>((resolve) => {
          finishSuggestion = resolve;
        });
      }
      return json({ suggestions: [{ artist: "Artist", title: "Track" }] });
    }
    throw new Error(`Unexpected controlled request: ${path}`);
  });
});
afterEach(() => {
  cleanup();
  clearTfSessionSecurityState();
  vi.unstubAllGlobals();
});
function renderHome() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <TfAuthProvider>
        <Controls />
        <TfSessionBoundary>
          <PlayerProvider>
            <Home />
          </PlayerProvider>
        </TfSessionBoundary>
      </TfAuthProvider>
    </QueryClientProvider>,
  );
}
async function startSearch() {
  renderHome();
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  fireEvent.click(screen.getByRole("button", { name: "Точный" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Исполнитель" }), {
    target: { value: "Artist" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Название трека" }), {
    target: { value: "Title" },
  });
  fireEvent.submit(
    screen.getByRole("form", { name: "Поиск музыки" }),
  );
  await waitFor(() => expect(searchStarted).toBe(true));
}
it("searches an explicit artist-title pair from the quick field", async () => {
  renderHome();
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  fireEvent.change(screen.getByPlaceholderText("Трек, исполнитель или ссылка"), {
    target: { value: "  Artist — Track - Live  " },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Поиск музыки" }));

  await waitFor(() => expect(searchStarted).toBe(true));
  expect(searchBody).toMatchObject({ artist: "Artist", title: "Track - Live", mode: "auto" });
  await settleSearch(json({ results: [], cached: false, sources: ["yt"] }));
});

it("searches an undelimited quick query without guessing artist and title", async () => {
  renderHome();
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  fireEvent.click(screen.getByLabelText("SoundCloud"));
  fireEvent.change(screen.getByPlaceholderText("Трек, исполнитель или ссылка"), {
    target: { value: "Unfamiliar song" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Поиск музыки" }));

  await waitFor(() => expect(searchStarted).toBe(true));
  expect(searchBody).toMatchObject({
    query: "Unfamiliar song", mode: "manual", sources: ["yt", "bc", "dz"],
  });
  expect(searchPath).toBe("/api/tracks/free-search");
  expect(searchBody).not.toHaveProperty("artist");
  await settleSearch(json({ results: [], cached: false, sources: ["yt"] }));
});
it("retries the failed search snapshot instead of edited fields and sources", async () => {
  renderHome();
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  fireEvent.click(screen.getByLabelText("SoundCloud"));
  const queryInput = screen.getByRole("combobox", { name: "Поиск" });
  fireEvent.change(queryInput, { target: { value: "Original query" } });
  fireEvent.submit(screen.getByRole("form", { name: "Поиск музыки" }));
  await waitFor(() => expect(searchStarted).toBe(true));
  const originalBody = searchBody;
  await settleSearch(json({ error: "search_unavailable" }, 503));

  fireEvent.change(queryInput, { target: { value: "Different query" } });
  fireEvent.click(screen.getByLabelText("YouTube"));
  searchStarted = false;
  fireEvent.click(screen.getByRole("button", { name: "Повторить запрос" }));
  await waitFor(() => expect(searchStarted).toBe(true));
  expect(searchPath).toBe("/api/tracks/free-search");
  expect(searchBody).toEqual(originalBody);
  expect(queryInput).toHaveValue("Different query");
  await settleSearch(json({ results: [], cached: false, sources: ["yt"] }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("heading", { name: "Треки не найдены" })).toBeInTheDocument();
});
it("resolves a pasted source link to metadata before ordinary candidate search", async () => {
  renderHome();
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  fireEvent.change(screen.getByPlaceholderText("Трек, исполнитель или ссылка"), {
    target: { value: "https://soundcloud.com/artist/track" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Поиск музыки" }));

  await waitFor(() => expect(searchStarted).toBe(true));
  expect(linkBody).toEqual({ url: "https://soundcloud.com/artist/track" });
  expect(searchPath).toBe("/api/tracks/search");
  expect(searchBody).toMatchObject({ artist: "Artist", title: "Track" });
  expect(JSON.stringify(searchBody)).not.toContain("soundcloud.com");
  await settleSearch(json({ results: [], cached: false, sources: ["sc"] }));
});
it("keeps an unsupported pasted link out of free search without revoking the session", async () => {
  linkResponse = json({ error: "unsupported_media_link" }, 422);
  renderHome();
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  fireEvent.change(screen.getByPlaceholderText("Трек, исполнитель или ссылка"), {
    target: { value: "https://open.spotify.com/track/example" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Поиск музыки" }));

  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("ссылк"));
  expect(searchStarted).toBe(false);
  expect(auth.status).toBe("authenticated");
});

it("shows link resolution throttling without searching or revoking the session", async () => {
  linkResponse = json({ error: "media_link_rate_limited" }, 429);
  renderHome();
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  fireEvent.change(screen.getByPlaceholderText("Трек, исполнитель или ссылка"), {
    target: { value: "https://soundcloud.com/artist/track" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Поиск музыки" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Слишком много запросов");
  expect(searchStarted).toBe(false);
  expect(auth.status).toBe("authenticated");
});

it("does not leave old results under a rejected pasted link", async () => {
  renderHome();
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  const input = screen.getByPlaceholderText("Трек, исполнитель или ссылка");
  fireEvent.change(input, { target: { value: "Previous" } });
  fireEvent.submit(screen.getByRole("form", { name: "Поиск музыки" }));
  await waitFor(() => expect(searchStarted).toBe(true));
  await settleSearch(json({
    query: "Previous", cached: false, sources: ["yt"], fallbackAvailable: false,
    results: [{ id: "old", title: "Previous Track", artist: "Old", type: "original", duration: 180,
      source: "youtube", thumbnailUrl: null, quality: [], score: 90 }],
  }));
  expect(screen.getByText("Previous Track")).toBeTruthy();

  linkResponse = json({ error: "unsupported_media_link" }, 422);
  fireEvent.change(input, { target: { value: "https://open.spotify.com/track/example" } });
  fireEvent.submit(screen.getByRole("form", { name: "Поиск музыки" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("Previous Track")).toBeNull();
});

it("does not search from a link resolved after the account changed", async () => {
  holdLink = true;
  renderHome();
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  fireEvent.change(screen.getByPlaceholderText("Трек, исполнитель или ссылка"), {
    target: { value: "https://soundcloud.com/artist/track" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Поиск музыки" }));
  await waitFor(() => expect(linkBody).not.toBeNull());
  identity = B;
  await act(async () => { await auth.refresh(); });
  await act(async () => { finishLink(json({ schemaVersion: 1, source: "soundcloud", artist: "Old", title: "Private" })); });
  expect(auth.session?.accountId).toBe(B);
  expect(searchStarted).toBe(false);
});
it("chooses a keyboard suggestion and searches with the current source filters", async () => {
  renderHome();
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  fireEvent.click(screen.getByLabelText("SoundCloud"));
  const queryInput = screen.getByPlaceholderText("Трек, исполнитель или ссылка");
  fireEvent.change(queryInput, { target: { value: "Tr" } });

  expect(await screen.findByRole("option", { name: "Artist - Track" })).toBeTruthy();
  fireEvent.keyDown(queryInput, { key: "ArrowDown" });
  fireEvent.keyDown(queryInput, { key: "Enter" });

  await waitFor(() => expect(searchStarted).toBe(true));
  expect(searchBody).toMatchObject({
    artist: "Artist",
    title: "Track",
    mode: "manual",
    sources: ["yt", "bc", "dz"],
  });
  expect(queryInput).toHaveProperty("value", "Artist — Track");
  await settleSearch(json({ results: [], cached: false, sources: ["yt"] }));
});

it("does not display a delayed suggestion from the previous account", async () => {
  holdSuggestion = true;
  renderHome();
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  fireEvent.change(screen.getByPlaceholderText("Трек, исполнитель или ссылка"), {
    target: { value: "Tr" },
  });
  await waitFor(() => expect(suggestionStarted).toBe(true));

  identity = B;
  await act(async () => { await auth.refresh(); });
  await act(async () => {
    finishSuggestion(json({ suggestions: [{ artist: "Old", title: "Private" }] }));
  });

  expect(auth.session?.accountId).toBe(B);
  expect(screen.queryByRole("option", { name: "Old - Private" })).toBeNull();
});
async function settleSearch(response: Response) {
  await act(async () => {
    finishSearch(response);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
it("rendered Home ignores the generated client's delayed A401 after B becomes active", async () => {
  await startSearch();
  identity = B;
  await act(async () => {
    await auth.refresh();
  });
  expect(auth.session?.accountId).toBe(B);
  await settleSearch(json({ error: "unauthorized" }, 401));
  expect(auth.status).toBe("authenticated");
  expect(auth.session?.accountId).toBe(B);
  expect(screen.getByPlaceholderText("Трек, исполнитель или ссылка")).toBeTruthy();
});
it("rendered Home cannot publish an old success after same-account generation renewal", async () => {
  await startSearch();
  await act(async () => {
    await auth.refresh();
  });
  await settleSearch(
    json({
      results: [
        {
          id: "old-a",
          title: "Stale A result",
          artist: "Old artist",
          duration: 50,
          thumbnailUrl: null,
          source: "youtube",
          type: "original",
          quality: [],
          score: 1,
        },
      ],
      cached: false,
      sources: ["yt"],
    }),
  );
  expect(auth.status).toBe("authenticated");
  expect(screen.queryByText("Stale A result")).toBeNull();
});
it("rendered Home still invalidates the current generation on a genuine current401", async () => {
  await startSearch();
  await settleSearch(json({ error: "unauthorized" }, 401));
  expect(auth.status).toBe("unauthenticated");
  expect(screen.queryByRole("button", { name: "Повторить запрос" })).toBeNull();
});
