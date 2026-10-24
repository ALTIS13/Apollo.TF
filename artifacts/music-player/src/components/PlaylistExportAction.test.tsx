import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TfAuthProvider, useTfAuth } from "@/auth/tf-auth";
import { commitTfSessionSecurityState } from "@/lib/tf-session-client";
import { PlaylistsCollection } from "./PlaylistsCollection";

const { toast, playCollection } = vi.hoisted(() => ({ toast: vi.fn(), playCollection: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/hooks/use-player", () => ({ usePlayer: () => ({ playTrack: vi.fn(), playCollection }) }));

const NativeURL = URL;
const createObjectURL = vi.fn((_blob: Blob) => "blob:playlist-export");
const revokeObjectURL = vi.fn();
const accountId = "10000000-0000-4000-8000-000000000001";
const playlist = { id: 9, name: "Night drive", description: null, trackCount: 2,
  createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" };
const recordings = [
  { trackId: "yt_first", artist: "Artist", title: "First", thumbnailUrl: null, durationSeconds: 180, position: 0, addedAt: playlist.createdAt },
  { trackId: "sc_second", artist: "Artist", title: "Second", thumbnailUrl: null, durationSeconds: 210, position: 1, addedAt: playlist.createdAt },
];
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  createObjectURL.mockReset().mockReturnValue("blob:playlist-export");
  revokeObjectURL.mockReset();
  vi.stubGlobal("URL", class extends NativeURL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = revokeObjectURL;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountPlaylist({ holdReorder = false, failDetail = false } = {}) {
  let auth: ReturnType<typeof useTfAuth> | undefined;
  let tracks = [...recordings];
  let releaseReorder: (() => void) | undefined;
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/auth/me")) return json({ accountId,
      installationId: "20000000-0000-4000-8000-000000000001", entitlements: ["tf.collections"],
      expiresAt: new Date(Date.now() + 300_000).toISOString(), csrfToken: "c".repeat(42) + "A" });
    if (path.endsWith("/collections/playlists")) return json({ playlists: [playlist] });
    if (path.endsWith("/collections/playlists/9/tracks/order") && init?.method === "PATCH") {
      if (holdReorder) await new Promise<void>((resolve) => { releaseReorder = resolve; });
      const { trackIds } = JSON.parse(String(init.body)) as { trackIds: string[] };
      tracks = trackIds.map((id, position) => ({ ...tracks.find((track) => track.trackId === id)!, position }));
      return json({ playlist, tracks });
    }
    if (path.endsWith("/collections/playlists/9")) {
      if (failDetail) return new Response(null, { status: 503 });
      return json({ playlist, tracks });
    }
    throw new Error("Unexpected request");
  });
  vi.stubGlobal("fetch", fetchMock);
  function Probe() { auth = useTfAuth(); return null; }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><TfAuthProvider><Probe /><PlaylistsCollection /></TfAuthProvider></QueryClientProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Night drive/ }));
  return { fetchMock, session: () => auth!.session!, releaseReorder: () => releaseReorder!() };
}

async function openExport() {
  const trigger = await screen.findByRole("button", { name: "Экспортировать плейлист" });
  await waitFor(() => expect(trigger).toBeEnabled());
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown", code: "ArrowDown" });
  return screen.findByRole("menuitem", { name: "JSON" });
}

it("exports the loaded playlist locally through the accessible format menu and releases its download URL", async () => {
  const { fetchMock } = await mountPlaylist();
  const downloads: string[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
  fireEvent.click(await openExport());
  expect(click).toHaveBeenCalledTimes(1);
  expect(downloads).toEqual(["Apollo TF - Night drive.json"]);
  expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== "GET")).toEqual([]);
  expect(playCollection).not.toHaveBeenCalled();
  expect(document.querySelector('a[download]')).toBeNull();
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:playlist-export"), { timeout: 2000 });
});

it("blocks export while order is unconfirmed and exports the acknowledged order", async () => {
  const fixture = await mountPlaylist({ holdReorder: true });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.click(await screen.findByRole("button", { name: "Переместить First ниже" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Экспортировать плейлист" })).toBeDisabled());
  await act(async () => fixture.releaseReorder());
  fireEvent.click(await openExport());
  expect(click).toHaveBeenCalledTimes(1);
  const blob = createObjectURL.mock.calls[0]?.[0] as unknown as Blob;
  const content = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
  expect(JSON.parse(content).tracks.map((track: { title: string }) => track.title)).toEqual(["Second", "First"]);
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(1), { timeout: 2000 });
});

it("does not export an old rendered session after a successful security-session replacement", async () => {
  const fixture = await mountPlaylist();
  const option = await openExport();
  commitTfSessionSecurityState({ ...fixture.session(), accountId: "10000000-0000-4000-8000-000000000002" });
  fireEvent.click(option);
  expect(createObjectURL).not.toHaveBeenCalled();
});

it("reports browser download failure and still releases the temporary URL", async () => {
  await mountPlaylist();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("download blocked"); });
  await openExport();
  fireEvent.click(screen.getByRole("menuitem", { name: "CSV" }));
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Не удалось экспортировать плейлист", variant: "destructive" }));
  expect(document.querySelector('a[download]')).toBeNull();
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledTimes(1), { timeout: 2000 });
});

it("offers no export from a failed playlist load", async () => {
  await mountPlaylist({ failDetail: true });
  expect(await screen.findByText("Не удалось загрузить плейлист.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Экспортировать плейлист" })).not.toBeInTheDocument();
  expect(createObjectURL).not.toHaveBeenCalled();
});
