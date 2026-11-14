import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TrackResult } from "@workspace/api-client-react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TfAuthProvider } from "@/auth/tf-auth";
import { PlaylistImportsCollection } from "@/components/PlaylistImportsCollection";
import { Player } from "@/components/Player";
import { PlayerProvider, usePlayer } from "@/hooks/use-player";
import { clearTfSessionSecurityState } from "@/lib/tf-session-client";

const accountId = "10000000-0000-4000-8000-000000000001";
const installationId = "20000000-0000-4000-8000-000000000001";
const draftId = "10000000-0000-4000-8000-000000000012";
const revision = "a".repeat(64);
const reviewedId = `rv_${draftId}_0_${revision}`;
const collection = "/api/collections/imports";
const slot = `${collection}/${draftId}/entries/0`;
const snapshotKey = `apollo_tf_queue_v1:${accountId}:${installationId}`;
const ordinary: TrackResult = { id: "yt_normal", artist: "Other artist", title: "Ordinary track", duration: 180, thumbnailUrl: null, source: "youtube", type: "original", quality: [], score: 0 };
const candidate = {
  id: "catalog", evidenceRevision: revision, artist: "Reviewed artist", title: "Reviewed recording",
  edition: "alternate", releaseDate: null, expectedDurationSeconds: 183, measuredDurationSeconds: 181,
  access: "full", download: "permitted", sourceLabel: "Catalog", sourceUrl: "https://catalog.test/attribution", mediaBound: true,
};
const saved = { candidateId: candidate.id, evidenceRevision: revision, selectedAt: "2026-11-12T00:00:00Z" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

class AudioDouble extends EventTarget {
  static current: AudioDouble;
  crossOrigin: string | null = null;
  currentTime = 0;
  duration = 0;
  volume = 0;
  source = "";
  assignments: { url: string; credentials: string | null }[] = [];
  constructor() { super(); AudioDouble.current = this; }
  get src() { return this.source; }
  set src(url: string) { this.source = url; if (url) this.assignments.push({ url, credentials: this.crossOrigin }); }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
  pause() { this.dispatchEvent(new Event("pause")); }
  async play() { this.dispatchEvent(new Event("play")); }
  load() {}
}

class SocketDouble {
  static current: SocketDouble;
  static OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor() { SocketDouble.current = this; }
  open() { this.readyState = 1; this.onopen?.(); }
  send(message: string) { this.sent.push(message); }
  close() { this.readyState = 3; }
}

function TestActions() {
  const { playTrack } = usePlayer();
  return <>
    <button type="button" onClick={() => void playTrack(ordinary)}>Play ordinary</button>
    <button type="button" onClick={() => void playTrack({ ...ordinary, id: `rv_${draftId}_200_${revision}`, source: "reviewed" })}>Play malformed</button>
  </>;
}

function mount(options: { selection?: typeof saved | null; binding?: boolean; access?: string; catalogDownload?: string; entitlement?: boolean } = {}) {
  let selection = options.selection === undefined ? saved : options.selection;
  const entry = { artist: "Input artist", title: "Imported track", durationSeconds: 183 };
  const summary = { id: draftId, name: "Draft", source: "file", createdAt: saved.selectedAt, entryCount: 1 };
  vi.stubGlobal("Audio", AudioDouble);
  vi.stubGlobal("WebSocket", SocketDouble);
  const http = vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url);
    if (path === "/api/auth/me") return json({ accountId, installationId, entitlements: ["tf.collections", "tf.search", ...(options.entitlement === false ? [] : ["tf.downloads"])],
      expiresAt: new Date(Date.now() + 300_000).toISOString(), csrfToken: "c".repeat(42) + "A" });
    if (path === "/api/ws/tickets") return json({ ticket: "a".repeat(42) + "A" }, 201);
    if (path === collection) return json({ imports: [summary] });
    if (path === `${collection}/${draftId}`) return json({ draft: { ...summary, entries: [entry] } });
    if (path === `${slot}/candidates`) return json({ status: "ready", selection, candidates: [{ ...candidate,
      ...(options.binding === false ? { mediaBound: undefined } : {}), access: options.access ?? candidate.access,
      download: options.catalogDownload ?? candidate.download,
    }] });
    if (path === `${slot}/selection` && init?.method === "PUT") { selection = saved; return json({ selection }); }
    if (path.startsWith("/api/tracks/yt_normal/stream")) return json({ streamUrl: "https://ordinary.test/audio" });
    if (path === "/api/tracks/play") return new Response(null, { status: 204 });
    if (path.startsWith("/api/tracks/lyrics?")) return json({ plainLyrics: null, syncedLyrics: null });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", http);
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TfAuthProvider>
    <PlayerProvider><TestActions /><PlaylistImportsCollection /><Player /></PlayerProvider>
  </TfAuthProvider></QueryClientProvider>);
  return { http, user: userEvent.setup() };
}

async function openReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Draft/ }));
  await user.click(await screen.findByRole("button", { name: /Подобрать запись: Imported track/ }));
  await screen.findByRole("radio", { name: candidate.title });
}

afterEach(() => {
  cleanup();
  clearTfSessionSecurityState();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

it("plays a confirmed binding only on click, clears its snapshot, and restores ordinary audio isolation", async () => {
  const { user, http } = mount({ selection: null });
  await openReview(user);
  await waitFor(() => expect(SocketDouble.current).toBeDefined());
  act(() => SocketDouble.current.open());
  await user.click(screen.getByRole("button", { name: "Play ordinary" }));
  await waitFor(() => expect(window.localStorage.getItem(snapshotKey)).toContain(ordinary.id));
  await user.click(screen.getByRole("button", { name: "Текст песни" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Воспроизвести выбранную запись" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("radio", { name: candidate.title }));
  await user.click(screen.getByRole("button", { name: "Подтвердить выбор" }));
  const play = await screen.findByRole("button", { name: "Воспроизвести выбранную запись" });
  expect(AudioDouble.current.assignments).toEqual([{ url: "https://ordinary.test/audio", credentials: null }]);
  const link = screen.getByRole("link", { name: "Скачать выбранную запись" });
  expect(link).toHaveAttribute("href", `${slot}/file/${revision}`);
  const ordinaryRequests = http.mock.calls.filter(([path]) => String(path).startsWith("/api/tracks/")).length;
  act(() => SocketDouble.current.onmessage?.(new MessageEvent("message", { data: JSON.stringify({
    type: "player_state", track: { ...ordinary, id: reviewedId }, position: 30, isPlaying: true,
  }) })));
  expect(AudioDouble.current.assignments).toHaveLength(1);
  await user.click(play);
  await waitFor(() => expect(AudioDouble.current.assignments.at(-1)).toEqual({ url: `${slot}/audio/${revision}`, credentials: "use-credentials" }));
  expect(screen.getByRole("button", { name: "Текст песни" })).toBeDisabled();
  await waitFor(() => expect(window.localStorage.getItem(snapshotKey)).toBeNull());
  expect(http.mock.calls.filter(([path]) => String(path).startsWith("/api/tracks/"))).toHaveLength(ordinaryRequests);
  expect(SocketDouble.current.sent.some((message) => message.includes(reviewedId) || message.includes(candidate.title))).toBe(false);
  await user.click(screen.getByRole("button", { name: "Play malformed" }));
  expect(AudioDouble.current.assignments).toHaveLength(2);
  expect(http.mock.calls.filter(([path]) => String(path).startsWith("/api/tracks/"))).toHaveLength(ordinaryRequests);
  await user.click(screen.getByRole("button", { name: "Play ordinary" }));
  await waitFor(() => expect(AudioDouble.current.assignments).toHaveLength(3));
  expect(AudioDouble.current.assignments.at(-1)).toEqual({ url: "https://ordinary.test/audio", credentials: null });
});

it.each([
  { binding: false }, { access: "preview" }, { selection: { ...saved, evidenceRevision: "b".repeat(64) } },
])("does not expose reviewed media without a current full binding: %j", async (options) => {
  const { user } = mount(options);
  await openReview(user);
  expect(screen.queryByRole("button", { name: "Воспроизвести выбранную запись" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Скачать выбранную запись" })).not.toBeInTheDocument();
  expect(AudioDouble.current.assignments).toEqual([]);
});

it.each([{ catalogDownload: "not_permitted" }, { entitlement: false }])("keeps playback separate from file permission: %j", async (options) => {
  const { user } = mount(options);
  await openReview(user);
  expect(screen.getByRole("button", { name: "Воспроизвести выбранную запись" })).toBeEnabled();
  expect(screen.queryByRole("link", { name: "Скачать выбранную запись" })).not.toBeInTheDocument();
});
