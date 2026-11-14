import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TfAuthProvider } from "@/auth/tf-auth";
import type { SpotifyAlbumOwner } from "@/hooks/use-spotify";
import { SpotifyImportError, type SpotifyImportPreview, type SpotifyImportRangeRequest, type SpotifyImportSelection } from "@/lib/spotify-import";
import { clearTfSessionSecurityState } from "@/lib/tf-session-client";
import { SpotifyImportAction } from "./SpotifyImportAction";

const read = vi.hoisted(() => vi.fn<(selection: SpotifyImportSelection, signal: AbortSignal, fetchPage: unknown, range: SpotifyImportRangeRequest) => Promise<SpotifyImportPreview>>());
vi.mock("@/lib/spotify-import", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/spotify-import")>(), readSpotifyImport: read }));

const owner: SpotifyAlbumOwner = ["10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001", "spotify-owner"];
const liked: SpotifyImportSelection = { kind: "liked", name: "Saved tracks" };
const playlist: SpotifyImportSelection = { kind: "playlist", id: "PlaylistA", name: "Playlist A" };
const album: SpotifyImportSelection = { kind: "album", id: "AlbumA", name: "Album A" };
const entry = { artist: "Artist", title: "Available track", durationSeconds: 183 };
const source = { liked: "spotify_liked", playlist: "spotify_playlist", album: "spotify_album" } as const;

function preview(selection: SpotifyImportSelection, offset: number, total: number, count: number): SpotifyImportPreview {
  const end = Math.min(offset + 200, total);
  const name = total > 200 ? `${selection.name} (${offset + 1}-${end})` : selection.name;
  return { range: { offset, end, total }, unavailable: end - offset - count,
    input: count ? { name, source: source[selection.kind], entries: Array.from({ length: count }, () => entry) } : null };
}

function setup(selection: SpotifyImportSelection, saveResponse?: () => Promise<Response>) {
  const http = vi.fn<typeof fetch>(async (input, init) => {
    const path = String(input);
    if (path === "/api/auth/me") return Response.json({ accountId: owner[0], installationId: owner[1],
      entitlements: ["tf.integrations", "tf.collections"], expiresAt: new Date(Date.now() + 300_000).toISOString(),
      csrfToken: "c".repeat(42) + "A" });
    if (path.startsWith("/api/collections/imports/") && init?.method === "PUT") return saveResponse?.() ?? Response.json({}, { status: 201 });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", http);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = (activeOwner: SpotifyAlbumOwner) => <QueryClientProvider client={client}><TfAuthProvider>
    <SpotifyImportAction owner={activeOwner} selection={selection} />
  </TfAuthProvider></QueryClientProvider>;
  const view = render(element(owner));
  return { user: userEvent.setup(), http, changeOwner: (activeOwner: SpotifyAlbumOwner) => view.rerender(element(activeOwner)) };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Импортировать метаданные" }));
  return screen.findByRole("dialog", { name: "Импорт из Spotify" });
}

afterEach(() => {
  cleanup();
  read.mockReset();
  vi.unstubAllGlobals();
  clearTfSessionSecurityState();
});

it("steps through large liked ranges only on request, including an empty range, and saves just the confirmed draft", async () => {
  read.mockImplementation(async (selection, _signal, _fetchPage, range) => preview(selection, range.offset, 450, range.offset === 200 ? 0 : 1));
  const { user, http } = setup(liked);
  const dialog = await open(user);
  const ui = within(dialog);
  await ui.findByText("Позиции 1–200 из 450");
  expect(ui.getByRole("button", { name: "Предыдущий диапазон" })).toBeDisabled();
  expect(read.mock.calls.map((call) => call[3])).toEqual([{ offset: 0 }]);
  expect(http.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  await user.click(ui.getByRole("button", { name: "Сохранить диапазон как черновик" }));
  expect(await ui.findByText("Диапазон сохранён как отдельный черновик.")).toBeInTheDocument();
  expect(ui.getByRole("button", { name: "Сохранить диапазон как черновик" })).toBeDisabled();
  expect(ui.getByRole("button", { name: "Следующий диапазон" })).toBeEnabled();
  expect(read).toHaveBeenCalledTimes(1);

  await user.click(ui.getByRole("button", { name: "Следующий диапазон" }));
  await ui.findByText("Позиции 201–400 из 450");
  expect(ui.getByText(/Недоступно: 200/)).toBeInTheDocument();
  expect(ui.queryByRole("button", { name: "Сохранить диапазон как черновик" })).not.toBeInTheDocument();
  await user.click(ui.getByRole("button", { name: "Следующий диапазон" }));
  await ui.findByText("Позиции 401–450 из 450");
  expect(ui.getByRole("button", { name: "Следующий диапазон" })).toBeDisabled();
  expect(read.mock.calls.map((call) => call[3])).toEqual([{ offset: 0 }, { offset: 200, expectedTotal: 450 }, { offset: 400, expectedTotal: 450 }]);
  expect(http.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1);

  await user.click(ui.getByRole("button", { name: "Сохранить диапазон как черновик" }));
  expect(await ui.findByText("Диапазон сохранён как отдельный черновик.")).toBeInTheDocument();
  expect(read).toHaveBeenCalledTimes(3);
  const writes = http.mock.calls.filter(([, init]) => init?.method === "PUT");
  expect(writes).toHaveLength(2);
  expect(writes[0][0]).not.toBe(writes[1][0]);
  expect(writes.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
    { name: `${liked.name} (1-200)`, source: "spotify_liked", entries: [entry] },
    { name: `${liked.name} (401-450)`, source: "spotify_liked", entries: [entry] },
  ]);

  await user.click(ui.getByRole("button", { name: "Предыдущий диапазон" }));
  await ui.findByText("Позиции 201–400 из 450");
  expect(read.mock.calls.at(-1)?.[3]).toEqual({ offset: 200, expectedTotal: 450 });
});

it("waits for explicit retry after a playlist total changes, then restarts at the first range", async () => {
  read.mockResolvedValueOnce(preview(playlist, 0, 450, 1))
    .mockRejectedValueOnce(new SpotifyImportError("changed"))
    .mockResolvedValueOnce(preview(playlist, 0, 150, 1));
  const { user, http } = setup(playlist);
  const ui = within(await open(user));
  await ui.findByText("Позиции 1–200 из 450");
  await user.click(ui.getByRole("button", { name: "Следующий диапазон" }));
  expect(await ui.findByRole("alert")).toHaveTextContent("Коллекция изменилась");
  expect(read).toHaveBeenCalledTimes(2);
  await user.click(ui.getByRole("button", { name: "Повторить" }));
  await ui.findByRole("button", { name: "Сохранить черновик" });
  expect(read.mock.calls.map((call) => call[3])).toEqual([{ offset: 0 }, { offset: 200, expectedTotal: 450 }, { offset: 0 }]);
  expect(ui.queryByRole("button", { name: "Следующий диапазон" })).not.toBeInTheDocument();
  expect(http.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
});

it("keeps the same album preview ID and body on an explicit save retry, with no range controls at 200 positions", async () => {
  let saves = 0;
  read.mockResolvedValueOnce(preview(album, 0, 200, 1));
  const { user, http } = setup(album, async () => {
    if (++saves === 1) throw new TypeError("response lost");
    return Response.json({}, { status: 200 });
  });
  const ui = within(await open(user));
  const button = await ui.findByRole("button", { name: "Сохранить черновик" });
  expect(ui.queryByRole("button", { name: "Следующий диапазон" })).not.toBeInTheDocument();
  await user.click(button);
  expect(await ui.findByRole("alert")).toHaveTextContent("Не удалось сохранить черновик");
  expect(saves).toBe(1);
  await user.click(button);
  expect(await screen.findByText("Черновик сохранён.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const writes = http.mock.calls.filter(([, init]) => init?.method === "PUT");
  expect(writes).toHaveLength(2);
  expect(writes[0][0]).toBe(writes[1][0]);
  expect(writes[0][1]?.body).toBe(writes[1][1]?.body);
  expect(read).toHaveBeenCalledTimes(1);
});

it("aborts a pending preview on Spotify owner change and ignores the late old response", async () => {
  let resolve!: (result: SpotifyImportPreview) => void;
  read.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { user, changeOwner } = setup(album);
  await open(user);
  const signal = read.mock.calls[0][1];
  expect(signal.aborted).toBe(false);
  act(() => changeOwner([owner[0], owner[1], "different-spotify-owner"]));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve(preview(album, 0, 450, 1)));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("Available track")).not.toBeInTheDocument();
});
