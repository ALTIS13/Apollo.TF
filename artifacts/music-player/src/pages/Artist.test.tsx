import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { TrackResult } from "@workspace/api-client-react";
import { TfAuthProvider, useTfAuth } from "@/auth/tf-auth";
import { artistHref, readArtistName } from "@/lib/artist-navigation";
import { clearTfSessionSecurityState } from "@/lib/tf-session-client";
import Artist from "./Artist";

vi.mock("@/hooks/use-player", () => ({
  usePlayer: () => ({ currentTrack: null, isPlaying: false, isLoading: false, playTrack: vi.fn(),
    togglePlayPause: vi.fn(), addToQueue: vi.fn(), addNextToQueue: vi.fn() }),
}));

const accountA = "10000000-0000-4000-8000-000000000001";
const accountB = "10000000-0000-4000-8000-000000000002";
const pathFor = (name: string) => `/api/tracks/artist?name=${encodeURIComponent(name)}`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function track(artist: string, title: string): TrackResult {
  return { id: "yt_fixture", artist, title, duration: 180, source: "youtube", type: "original", quality: ["128"], score: 1 };
}

function RefreshControl() {
  const { refresh } = useTfAuth();
  return <button type="button" onClick={() => void refresh()}>Refresh Apollo session</button>;
}
function setup(path: string, artistRequest: (path: string) => Response | Promise<Response>, allowed = true, browserHistory = false) {
  let accountId = accountA;
  const http = vi.fn<typeof fetch>(async (input) => {
    const path = String(input);
    if (path === "/api/auth/me") return json({ accountId, installationId: "20000000-0000-4000-8000-000000000001",
      entitlements: allowed ? ["tf.search", "tf.downloads"] : ["tf.collections"], expiresAt: new Date(Date.now() + 300_000).toISOString(),
      csrfToken: "c".repeat(42) + "A" });
    if (path.startsWith("/api/tracks/artist?")) return artistRequest(path);
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", http);
  const location = browserHistory ? null : memoryLocation({ path });
  if (browserHistory) window.history.replaceState({}, "", path);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TfAuthProvider><Router hook={location?.hook}>
    <RefreshControl /><Artist />
  </Router></TfAuthProvider></QueryClientProvider>);
  return { http, navigate: (next: string) => location ? location.navigate(next) : window.history.pushState({}, "", next), user: userEvent.setup(),
    switchAccount: () => { accountId = accountB; } };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  clearTfSessionSecurityState();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("round-trips one normalized artist through a strictly parsed query", () => {
  expect(artistHref("  Cafe\u0301   + A&B #  ")).toBe("/artist?name=Caf%C3%A9%20%2B%20A%26B%20%23");
  expect(readArtistName("?name=Cafe%CC%81+%2B+A%26B+%23")).toBe("Caf\u00e9 + A&B #");
  expect(readArtistName("name=A%3DB")).toBe("A=B");
  expect(artistHref("a".repeat(200))).not.toBeNull();
  for (const name of ["a".repeat(201), `A${" ".repeat(199)}B`, "   ", "A\tB", "A\u007fB", "A\u202eB", "A\uD800B"]) expect(artistHref(name)).toBeNull();
  for (const query of ["", "?name", "?name=", "?name=A&name=B", "?name=A&%6eame=B", "?name=A&", "?name=A&other=B", "?name=A#B", "?name=%E0%A4%A", "?name=%ZZ", "?name=%09A", "?name=%E2%80%AEA", "?name=A\uD800B"]) {
    expect(readArtistName(query)).toBeNull();
  }
});

it("shows partial results without claiming the list is complete, and does not require collections access", async () => {
  const artist = "Caf\u00e9 & X";
  const { http } = setup("/artist?name=Cafe%CC%81+++%26+X", () => json({
    schemaVersion: 1, artist, results: [track(artist, "Available track")], partial: true,
  }));
  expect(await screen.findByText("Показаны не все доступные треки.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Available track" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Скачать" })).not.toBeInTheDocument();
  expect(http).toHaveBeenCalledWith(pathFor(artist), expect.objectContaining({ method: "GET", cache: "no-store", credentials: "include" }));
  expect(http.mock.calls.some(([path]) => String(path).includes("/collections/"))).toBe(false);
});

it("keeps a catalog failure local, retries explicitly, and distinguishes a valid empty response", async () => {
  let reads = 0;
  const { user } = setup("/artist?name=First", () => ++reads === 1
    ? json({ error: "artist_discovery_unavailable", detail: "private detail" }, 503)
    : json({ schemaVersion: 1, artist: "First", results: [], partial: false }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить треки исполнителя.");
  expect(screen.getByRole("alert")).not.toHaveTextContent("private detail");
  expect(reads).toBe(1);
  await user.click(screen.getByRole("button", { name: "Повторить" }));
  expect(await screen.findByText("Треки исполнителя не найдены.")).toBeInTheDocument();
  expect(reads).toBe(2);
});

it("does not render malformed response tracks or treat them as an empty catalog", async () => {
  setup("/artist?name=First", () => json({ schemaVersion: 1, artist: "First", partial: false,
    results: [{ title: "Must not render" }] }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить треки исполнителя.");
  expect(screen.queryByText("Must not render")).not.toBeInTheDocument();
  expect(screen.queryByText("Треки исполнителя не найдены.")).not.toBeInTheDocument();
});

it("updates on same-route search changes and discards late replies", async () => {
  const first = deferredResponse();
  const second = deferredResponse();
  const { http, navigate } = setup("/artist?name=First", (path) => path === pathFor("First") ? first.promise : second.promise);
  const signal = (name: string) => http.mock.calls.find(([path]) => path === pathFor(name))?.[1]?.signal;
  await waitFor(() => expect(signal("First")?.aborted).toBe(false));
  act(() => navigate("/artist?name=Second"));
  expect(signal("First")?.aborted).toBe(true);
  expect(screen.getByRole("heading", { name: "Second" })).toBeInTheDocument();
  await act(async () => first.resolve(json({ error: "unauthorized" }, 401)));
  await waitFor(() => expect(signal("Second")?.aborted).toBe(false));
  await act(async () => second.resolve(json({ schemaVersion: 1, artist: "Second", results: [track("Second", "Second result")], partial: false })));
  expect(await screen.findByRole("heading", { name: "Second result" })).toBeInTheDocument();
  act(() => navigate("/artist?name=First&name=Second"));
  expect(screen.queryByRole("heading", { name: "Second result" })).not.toBeInTheDocument();
  expect(screen.getByText("Некорректное имя исполнителя.")).toBeInTheDocument();
  expect(http.mock.calls.filter(([path]) => String(path).includes("/tracks/artist?")).length).toBe(2);
});

it("preserves literal percent sequences and updates on history back and forward", async () => {
  const name = "100% %26";
  const { http, navigate } = setup("/artist?name=100%25%20%2526", (path) => json({
    schemaVersion: 1, artist: path === pathFor(name) ? name : "Other", results: [], partial: false,
  }), true, true);
  expect(await screen.findByText("Треки исполнителя не найдены.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name })).toBeInTheDocument();
  expect(http).toHaveBeenCalledWith(pathFor(name), expect.any(Object));
  act(() => navigate("/artist?name=Other"));
  expect(await screen.findByRole("heading", { name: "Other" })).toBeInTheDocument();
  act(() => window.history.back());
  expect(await screen.findByRole("heading", { name })).toBeInTheDocument();
  act(() => window.history.forward());
  expect(await screen.findByRole("heading", { name: "Other" })).toBeInTheDocument();
});

it("aborts a request on verified account change and never renders that account's late response", async () => {
  const first = deferredResponse();
  let reads = 0;
  const { http, user, switchAccount } = setup("/artist?name=First", () => ++reads === 1 ? first.promise
    : json({ schemaVersion: 1, artist: "First", results: [track("First", "New account result")], partial: false }));
  const signal = () => http.mock.calls.find(([path]) => path === pathFor("First"))?.[1]?.signal;
  await waitFor(() => expect(signal()?.aborted).toBe(false));
  switchAccount();
  await user.click(screen.getByRole("button", { name: "Refresh Apollo session" }));
  expect(await screen.findByRole("heading", { name: "New account result" })).toBeInTheDocument();
  expect(signal()?.aborted).toBe(true);
  await act(async () => first.resolve(json({ schemaVersion: 1, artist: "First", results: [track("First", "Old account result")], partial: false })));
  expect(screen.queryByText("Old account result")).not.toBeInTheDocument();
});

it("does not request catalog data without tf.search", async () => {
  const { http } = setup("/artist?name=First", () => { throw new Error("Artist request is not allowed"); }, false);
  expect(await screen.findByText("Треки исполнителя недоступны для этого аккаунта.")).toBeInTheDocument();
  expect(http.mock.calls.some(([path]) => String(path).includes("/tracks/artist?"))).toBe(false);
});
