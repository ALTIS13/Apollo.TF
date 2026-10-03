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
import { Link, Route, Router } from "wouter";
import type { TrackResult } from "@workspace/api-client-react";
import Home from "@/pages/Home";
import { PlayerProvider, usePlayer } from "@/hooks/use-player";
import { Toaster } from "@/components/ui/toaster";
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
let searchCalls: unknown[];
let linkBody: unknown;
let linkResponse: Response;
let holdLink: boolean;
let finishLink: (response: Response) => void;
let suggestionStarted: boolean;
let holdSuggestion: boolean;
let finishSuggestion: (response: Response) => void;
let player: ReturnType<typeof usePlayer>;
let recordingPlaybackEnabled: boolean;
let streamRequests: string[];
let playbackRequests: string[];
let holdAlternateStream: boolean;
let finishAlternateStream: (response: Response) => void;
function recording(id: string, title: string, source: TrackResult["source"]): TrackResult {
  return {
    id, title, source, artist: "Artist & Friends", duration: 180,
    thumbnailUrl: null, type: "original", quality: [], score: 90,
  };
}
const failedRecording = recording("yt_failed_recording", "Track (Live at Wembley)", "youtube");
const alternateRecording = recording("bc_alternate_recording", "Alternate Recording", "bandcamp");
const replacementQueue = [
  recording("sc_queue_before", "Queue Before", "soundcloud"),
  failedRecording,
  failedRecording,
  recording("sc_queue_after", "Queue After", "soundcloud"),
];
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
function PlayerControls() {
  player = usePlayer();
  return null;
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
  async play() {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  }
  load() {}
}
beforeEach(() => {
  window.history.replaceState(null, "", "/");
  clearTfSessionSecurityState();
  localStorage.removeItem("tf_source_prefs");
  identity = A;
  searchStarted = false;
  searchBody = null;
  searchPath = "";
  searchCalls = [];
  linkBody = null;
  linkResponse = json({ schemaVersion: 1, source: "soundcloud", artist: "Artist", title: "Track", durationSeconds: 180 });
  holdLink = false;
  suggestionStarted = false;
  holdSuggestion = false;
  recordingPlaybackEnabled = false;
  streamRequests = [];
  playbackRequests = [];
  holdAlternateStream = false;
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
      searchCalls.push(searchBody);
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
    if (recordingPlaybackEnabled) {
      const track = [...replacementQueue, alternateRecording].find(
        (candidate) => path === `/api/tracks/${candidate.id}/stream`,
      );
      if (track) {
        streamRequests.push(track.id);
        if (track.id === alternateRecording.id && holdAlternateStream) {
          return new Promise<Response>((resolve) => { finishAlternateStream = resolve; });
        }
        return track.id === failedRecording.id
          ? json({ error: "stream_error" }, 502)
          : json({ streamUrl: `https://stream.invalid/${track.id}.mp3` });
      }
      if (path === "/api/collections/liked/lookup") return json({ likedTrackIds: [] });
      if (path === "/api/tracks/play") {
        playbackRequests.push(JSON.parse(String(init?.body)).trackId);
        return json({});
      }
    }
    throw new Error(`Unexpected controlled request: ${path}`);
  });
});
afterEach(() => {
  cleanup();
  if (recordingPlaybackEnabled) clearRecordingQueues();
  clearTfSessionSecurityState();
  vi.unstubAllGlobals();
});
function SourceRecoveryLinks() {
  const first = new URLSearchParams({
    artist: "  Artist & Friends  ", title: "  Track (Live at Wembley)  ", view: "compact",
  });
  const second = new URLSearchParams({
    artist: "Second Artist", title: "Second Track - Live", view: "second",
  });
  return (
    <>
      <Link href={`/?${first}#source`}>Recover first source</Link>
      <Link href={`/?${second}#source`}>Recover second source</Link>
    </>
  );
}

function renderHome(recoveryNavigation = false, recordingRecovery = false) {
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
      <Router>
        <TfAuthProvider>
          <Controls />
          <TfSessionBoundary>
            <PlayerProvider>
              <Route path="/" component={Home} />
              {recoveryNavigation && <SourceRecoveryLinks />}
              {recordingRecovery && <><PlayerControls /><Toaster /></>}
            </PlayerProvider>
          </TfSessionBoundary>
        </TfAuthProvider>
      </Router>
    </QueryClientProvider>,
  );
}
function clearRecordingQueues() {
  for (const accountId of [A, B]) {
    localStorage.removeItem(`apollo_tf_queue_v1:${accountId}:22222222-2222-4222-8222-222222222222`);
  }
}
async function startRecordingReplacementSearch() {
  recordingPlaybackEnabled = true;
  clearRecordingQueues();
  renderHome(true, true);
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  const input = screen.getByRole("combobox", { name: "Поиск" });
  fireEvent.click(screen.getByLabelText("SoundCloud"));
  await act(async () => {
    await player.playCollection(replacementQueue);
    await player.playFromQueue(1);
  });
  expect(player.queue).toEqual(replacementQueue);
  expect(player.queueIndex).toBe(1);
  expect(player.currentTrack).toBeNull();
  expect(streamRequests).toEqual([replacementQueue[0].id, failedRecording.id]);
  const action = await screen.findByRole("link", { name: "Найти другую запись" });
  const href = new URL(action.getAttribute("href")!, window.location.href);
  const spaNavigation = !fireEvent.click(action);
  await waitFor(() => expect(searchCalls).toHaveLength(1));
  return { input, href, spaNavigation };
}
function replacementResults(...results: TrackResult[]) {
  return json({ results, cached: false, sources: ["yt", "bc"] });
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

it("source-recovery Link searches once on the same mounted Home with exact version and current sources", async () => {
  linkResponse = json({ error: "unsupported_media_link" }, 422);
  renderHome(true);
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  const input = screen.getByRole("combobox", { name: "Поиск" });
  fireEvent.click(screen.getByLabelText("SoundCloud"));
  fireEvent.change(input, { target: { value: "https://open.spotify.com/track/example" } });
  fireEvent.submit(screen.getByRole("form", { name: "Поиск музыки" }));
  await screen.findByRole("alert");

  fireEvent.click(screen.getByRole("link", { name: "Recover first source" }));
  await waitFor(() => expect(searchCalls).toHaveLength(1));
  expect(searchPath).toBe("/api/tracks/search");
  expect(searchBody).toEqual({
    artist: "Artist & Friends", title: "Track (Live at Wembley)", mode: "manual", sources: ["yt", "bc", "dz"],
  });
  expect(screen.getByRole("combobox", { name: "Поиск" })).toBe(input);
  expect(input).toHaveValue("Artist & Friends — Track (Live at Wembley)");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(window.location.search).toBe("?view=compact");
  expect(window.location.hash).toBe("#source");
  await settleSearch(json({ results: [], cached: false, sources: ["yt"] }));

  fireEvent.click(screen.getByRole("button", { name: "Точный" }));
  expect(screen.getByRole("textbox", { name: "Исполнитель" })).toHaveValue("Artist & Friends");
  expect(screen.getByRole("combobox", { name: "Название трека" })).toHaveValue("Track (Live at Wembley)");
  fireEvent.click(screen.getByLabelText("YouTube"));
  expect(searchCalls).toHaveLength(1);
});

it("source-recovery initial query is consumed once while preserving unrelated URL and history state", async () => {
  const query = new URLSearchParams({ artist: " Initial Artist ", title: "Initial Track (LIVE)", keep: "value" });
  window.history.replaceState({ checkpoint: "keep" }, "", `/?${query}#source`);
  renderHome();
  await waitFor(() => expect(searchCalls).toHaveLength(1));
  expect(searchBody).toEqual({ artist: "Initial Artist", title: "Initial Track (LIVE)", mode: "auto" });
  expect(screen.getByRole("combobox", { name: "Поиск" })).toHaveValue("Initial Artist — Initial Track (LIVE)");
  expect(window.location.search).toBe("?keep=value");
  expect(window.location.hash).toBe("#source");
  expect(window.history.state).toEqual({ checkpoint: "keep" });
  await settleSearch(json({ results: [], cached: false, sources: ["yt"] }));
  fireEvent.click(screen.getByLabelText("SoundCloud"));
  await act(async () => { await auth.refresh(); });
  expect(searchCalls).toHaveLength(1);
});

it.each([
  ["missing artist", new URLSearchParams({ title: "Track" })],
  ["blank artist", new URLSearchParams({ artist: "   ", title: "Track" })],
  ["blank title", new URLSearchParams({ artist: "Artist", title: "   " })],
  ["oversized artist", new URLSearchParams({ artist: "a".repeat(201), title: "Track" })],
  ["oversized title", new URLSearchParams({ artist: "Artist", title: "t".repeat(301) })],
  ["ambiguous artist", new URLSearchParams([["artist", "First"], ["artist", "Second"], ["title", "Track"]])],
] as const)("source-recovery ignores an invalid initial pair with %s", async (_label, query) => {
  window.history.replaceState(null, "", `/?${query}`);
  renderHome();
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  expect(searchCalls).toHaveLength(0);
  expect(screen.getByRole("combobox", { name: "Поиск" })).toHaveValue("");
  expect(suggestionStarted).toBe(false);
});

it("source-recovery supports back and new repeated navigation without replaying consumed entries", async () => {
  renderHome(true);
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  const input = screen.getByRole("combobox", { name: "Поиск" });
  fireEvent.click(screen.getByRole("link", { name: "Recover first source" }));
  await waitFor(() => expect(searchCalls).toHaveLength(1));
  await settleSearch(json({ results: [], cached: false, sources: ["yt"] }));
  fireEvent.click(screen.getByRole("link", { name: "Recover second source" }));
  await waitFor(() => expect(searchCalls).toHaveLength(2));
  await settleSearch(json({ results: [], cached: false, sources: ["yt"] }));
  await act(async () => {
    const popped = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
    window.history.back();
    await popped;
  });
  expect(window.location.search).toBe("?view=compact");
  expect(searchCalls).toHaveLength(2);
  expect(screen.getByRole("combobox", { name: "Поиск" })).toBe(input);
  fireEvent.click(screen.getByRole("link", { name: "Recover first source" }));
  await waitFor(() => expect(searchCalls).toHaveLength(3));
  expect(searchCalls[2]).toEqual({ artist: "Artist & Friends", title: "Track (Live at Wembley)", mode: "auto" });
  await settleSearch(json({ results: [], cached: false, sources: ["yt"] }));
});

it("source-recovery supersedes pending link metadata and stale suggestions on mounted Home", async () => {
  holdLink = true;
  holdSuggestion = true;
  renderHome(true);
  await waitFor(() => expect(auth.status).toBe("authenticated"));
  const input = screen.getByRole("combobox", { name: "Поиск" });
  fireEvent.change(input, { target: { value: "Tr" } });
  await waitFor(() => expect(suggestionStarted).toBe(true));
  fireEvent.change(input, { target: { value: "https://soundcloud.com/artist/track" } });
  fireEvent.submit(screen.getByRole("form", { name: "Поиск музыки" }));
  await waitFor(() => expect(linkBody).not.toBeNull());
  fireEvent.click(screen.getByRole("link", { name: "Recover first source" }));
  await waitFor(() => expect(searchCalls).toHaveLength(1));
  await act(async () => {
    finishSuggestion(json({ suggestions: [{ artist: "Old", title: "Suggestion" }] }));
    finishLink(json({ schemaVersion: 1, source: "soundcloud", artist: "Old", title: "Link Title" }));
  });
  await settleSearch(json({ results: [], cached: false, sources: ["yt"] }));
  expect(searchCalls).toHaveLength(1);
  expect(input).toHaveValue("Artist & Friends — Track (Live at Wembley)");
  expect(screen.queryByRole("option")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("recording-replacement toast keeps mounted Home and replaces only the failed duplicate occurrence", async () => {
  const { input, href, spaNavigation } = await startRecordingReplacementSearch();
  const token = href.searchParams.get("replacement");
  expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(href.searchParams.get("artist")).toBe(failedRecording.artist);
  expect(href.searchParams.get("title")).toBe(failedRecording.title);
  expect(spaNavigation).toBe(true);
  expect(screen.getByRole("combobox", { name: "Поиск" })).toBe(input);
  expect(input).toHaveValue(`${failedRecording.artist} — ${failedRecording.title}`);
  expect(screen.getByText("Замена записи в очереди")).toBeInTheDocument();
  expect(player.queue).toEqual(replacementQueue);
  expect(searchPath).toBe("/api/tracks/search");
  expect(searchBody).toEqual({
    artist: failedRecording.artist, title: failedRecording.title,
    mode: "manual", sources: ["yt", "bc", "dz"],
  });
  expect(searchBody).not.toHaveProperty("replacement");
  expect(JSON.stringify(searchBody)).not.toContain(token!);

  await settleSearch(replacementResults(failedRecording, alternateRecording));
  expect(screen.getByRole("button", { name: `Заменить запись: ${failedRecording.title}` })).toBeDisabled();
  const candidate = screen.getByRole("button", { name: `Заменить запись: ${alternateRecording.title}` });
  expect(candidate).toBeEnabled();
  holdAlternateStream = true;
  fireEvent.click(candidate);
  await waitFor(() => expect(streamRequests).toContain(alternateRecording.id));
  expect(candidate).toBeDisabled();
  fireEvent.click(candidate);
  expect(streamRequests.filter((id) => id === alternateRecording.id)).toHaveLength(1);
  await act(async () => {
    finishAlternateStream(json({ streamUrl: "https://stream.invalid/replacement.mp3" }));
  });
  await waitFor(() => expect(player.isPlaying).toBe(true));
  expect(player.queue).toEqual([
    replacementQueue[0], alternateRecording, failedRecording, replacementQueue[3],
  ]);
  expect(player.queueIndex).toBe(1);
  expect(player.currentTrack).toEqual(alternateRecording);
  expect(playbackRequests).toEqual([replacementQueue[0].id, alternateRecording.id]);
  expect(searchCalls).toHaveLength(1);
});

it("recording-replacement canceled results cannot fall back to ordinary playback", async () => {
  await startRecordingReplacementSearch();
  await settleSearch(replacementResults(alternateRecording));
  const candidate = screen.getByRole("button", { name: `Заменить запись: ${alternateRecording.title}` });
  fireEvent.click(screen.getByRole("button", { name: "Отменить замену" }));
  expect(player.recordingReplacement).toBeNull();
  expect(screen.queryByRole("button", { name: `Воспроизвести: ${alternateRecording.title}` })).toBeNull();
  if (document.body.contains(candidate)) expect(candidate).toBeDisabled();
  await act(async () => { fireEvent.click(candidate); });
  expect(player.queue).toEqual(replacementQueue);
  expect(player.queueIndex).toBe(1);
  expect(player.currentTrack).toBeNull();
  expect(streamRequests).toEqual([replacementQueue[0].id, failedRecording.id]);
  expect(playbackRequests).toEqual([replacementQueue[0].id]);
});

it("recording-replacement stale results stay disabled after a newer queue load", async () => {
  await startRecordingReplacementSearch();
  await settleSearch(replacementResults(replacementQueue[3]));
  await act(async () => { await player.playFromQueue(3); });
  expect(screen.getByText("Запрос замены устарел")).toBeInTheDocument();
  const candidate = screen.getByRole("button", { name: `Заменить запись: ${replacementQueue[3].title}` });
  expect(candidate).toBeDisabled();
  expect(screen.queryByRole("button", { name: `Воспроизвести: ${replacementQueue[3].title}` })).toBeNull();
  expect(screen.queryByRole("button", { name: `Пауза: ${replacementQueue[3].title}` })).toBeNull();
  await act(async () => { fireEvent.click(candidate); });
  expect(player.queue).toEqual(replacementQueue);
  expect(player.queueIndex).toBe(3);
  expect(player.currentTrack).toEqual(replacementQueue[3]);
  expect(player.isPlaying).toBe(true);
  expect(streamRequests).toEqual([replacementQueue[0].id, failedRecording.id, replacementQueue[3].id]);
  expect(playbackRequests).toEqual([replacementQueue[0].id, replacementQueue[3].id]);
});

it("recording-replacement pending cancellation stops audio and preserves a newer ordinary search", async () => {
  await startRecordingReplacementSearch();
  await settleSearch(replacementResults(alternateRecording));
  holdAlternateStream = true;
  fireEvent.click(screen.getByRole("button", { name: `Заменить запись: ${alternateRecording.title}` }));
  await waitFor(() => expect(streamRequests).toContain(alternateRecording.id));
  fireEvent.click(screen.getByRole("button", { name: "Отменить замену" }));
  const input = screen.getByRole("combobox", { name: "Поиск" });
  fireEvent.change(input, { target: { value: "New ordinary query" } });
  fireEvent.submit(screen.getByRole("form", { name: "Поиск музыки" }));
  await waitFor(() => expect(searchCalls).toHaveLength(2));
  await settleSearch(json({ results: [], cached: false, sources: ["yt"] }));
  await act(async () => { finishAlternateStream(json({ streamUrl: "https://stream.invalid/late.mp3" })); });
  expect(input).toHaveValue("New ordinary query");
  expect(screen.getByRole("heading", { name: "Треки не найдены" })).toBeInTheDocument();
  expect(screen.queryByText("Запись в очереди заменена")).toBeNull();
  expect(screen.queryByText("Замена записи в очереди")).toBeNull();
  expect(player.currentTrack).toBeNull();
  expect(player.isPlaying).toBe(false);
  expect(player.isLoading).toBe(false);
  expect(player.queue).toEqual([replacementQueue[0], alternateRecording, failedRecording, replacementQueue[3]]);
  expect(playbackRequests).toEqual([replacementQueue[0].id]);
});

it.each([
  { label: "source-recovery", recordingRecovery: false },
  { label: "recording-replacement", recordingRecovery: true },
])("$label cannot publish an old-account result after a fresh account navigation", async ({ recordingRecovery }) => {
  if (recordingRecovery) {
    await startRecordingReplacementSearch();
  } else {
    renderHome(true);
    await waitFor(() => expect(auth.status).toBe("authenticated"));
    fireEvent.click(screen.getByRole("link", { name: "Recover first source" }));
    await waitFor(() => expect(searchCalls).toHaveLength(1));
  }
  const finishOldSearch = finishSearch;
  identity = B;
  await act(async () => { await auth.refresh(); });
  expect(auth.session?.accountId).toBe(B);
  expect(searchCalls).toHaveLength(1);
  fireEvent.click(screen.getByRole("link", { name: "Recover second source" }));
  await waitFor(() => expect(searchCalls).toHaveLength(2));
  await act(async () => {
    finishOldSearch(json({
      results: [{
        id: "old-account", artist: "Old", title: "Private Old Result", duration: 180, thumbnailUrl: null,
        source: "youtube", type: "original", quality: [], score: 1,
      }],
      cached: false, sources: ["yt"],
    }));
  });
  await settleSearch(json({ results: [], cached: false, sources: ["yt"] }));
  expect(auth.status).toBe("authenticated");
  expect(auth.session?.accountId).toBe(B);
  expect(screen.queryByText("Private Old Result")).toBeNull();
  expect(screen.getByRole("combobox", { name: "Поиск" })).toHaveValue("Second Artist — Second Track - Live");
  if (recordingRecovery) {
    expect(player.queue).toEqual([]);
    expect(player.currentTrack).toBeNull();
    expect(player.recordingReplacement).toBeNull();
  }
});
