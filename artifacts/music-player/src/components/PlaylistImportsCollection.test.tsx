import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TfAuthProvider, useTfAuth } from "@/auth/tf-auth";
import { clearTfSessionSecurityState } from "@/lib/tf-session-client";
import { PlaylistImportsCollection } from "./PlaylistImportsCollection";

const route = "/api/collections/imports";
const accountId = "10000000-0000-4000-8000-000000000001";
const installationA = "20000000-0000-4000-8000-000000000001";
const installationB = "20000000-0000-4000-8000-000000000002";
const entries = [
  { artist: "Zeta", title: "Quiet Hours", durationSeconds: 183 },
  { artist: "Alpha", title: "First Light", durationSeconds: null },
  { artist: "Zeta", title: "Quiet Hours", durationSeconds: 183 },
];
const input = { name: "Night mix", source: "file", entries };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function exportFile(tracks: unknown = entries) {
  return new File([JSON.stringify({
    schemaVersion: "apollo.tf.playlist-export.v1",
    playlist: { name: input.name, description: "Not part of the draft" },
    tracks,
  })], "playlist.json", { type: "application/json" });
}

const archiveSong = {
  artist: "Archive Artist", track: "Archive Track", uri: "spotify:track:1234567890123456789012",
  album: "private-album", audioUrl: "https://example.invalid/private-audio",
};

function spotifyFile(tracks: unknown[]) {
  return new File([JSON.stringify({ tracks, account: { username: "private-account" } })],
    "YourLibrary.json", { type: "application/json" });
}

async function reviewSpotifyFile(user: ReturnType<typeof userEvent.setup>, file: File) {
  const picker = await screen.findByLabelText<HTMLInputElement>("Файл экспорта Spotify");
  await user.upload(picker, file);
  expect(picker.files).toHaveLength(0);
  return within(await screen.findByRole("region", { name: "Проверка импорта" }));
}

function reviewSpotify(user: ReturnType<typeof userEvent.setup>, tracks: unknown[]) {
  return reviewSpotifyFile(user, spotifyFile(tracks));
}

function spotifyPlaylistFile(playlists: unknown[]) {
  return new File([JSON.stringify({ playlists, account: "private-account" })],
    "Playlist1.json", { type: "application/json" });
}

function playlistItem(trackName: string) {
  return { track: {
    artistName: "Archive Artist", trackName, trackUri: archiveSong.uri, albumName: "private-album",
  }, addedDate: "2026-01-01" };
}

function RefreshAccess() {
  const { refresh } = useTfAuth();
  return <button type="button" onClick={() => void refresh()}>Refresh access</button>;
}

function setup(respond: (path: string, init: RequestInit) => Response | Promise<Response>) {
  let entitled = true;
  let installationId = installationA;
  const http = vi.fn<typeof fetch>((url, init = {}) => {
    if (url === "/api/auth/me") return Promise.resolve(json({
      accountId, installationId,
      entitlements: entitled ? ["tf.collections"] : [],
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      csrfToken: "c".repeat(42) + "A",
    }));
    return Promise.resolve(respond(String(url), init));
  });
  vi.stubGlobal("fetch", http);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TfAuthProvider>
    <RefreshAccess />
    <PlaylistImportsCollection />
  </TfAuthProvider></QueryClientProvider>);
  return { http, user: userEvent.setup(), revoke: () => { entitled = false; }, switchInstallation: () => { installationId = installationB; } };
}

function saved(id: string, name = input.name) {
  return { id, name, source: input.source, entryCount: entries.length, createdAt: "2026-11-12T00:00:00Z" };
}

async function review(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(await screen.findByLabelText("Файл экспорта TF"), exportFile());
  await screen.findByRole("heading", { name: "Проверка импорта" });
}

afterEach(() => {
  cleanup();
  clearTfSessionSecurityState();
  vi.unstubAllGlobals();
});

it("reviews file metadata before saving and deletes only after confirmation with provider access off", async () => {
  let id: string | null = null;
  const { http, user } = setup((path, init) => {
    if (path === route) return json({ imports: id ? [saved(id)] : [] });
    if (path.startsWith(`${route}/`) && init.method === "PUT") {
      id = path.split("/").at(-1)!;
      return json({ draft: { ...saved(id), entries } }, 201);
    }
    if (path === `${route}/${id}` && init.method === "DELETE") {
      id = null;
      return new Response(null, { status: 204 });
    }
    if (path === `${route}/${id}` && id) return json({ draft: { ...saved(id), entries } });
    throw new Error(`Unexpected request: ${path}`);
  });
  await review(user);
  const items = within(screen.getByRole("list", { name: "Записи черновика" })).getAllByRole("listitem");
  expect(items.map((item) => within(item).getByText(/Quiet Hours|First Light/).textContent)).toEqual(["Quiet Hours", "First Light", "Quiet Hours"]);
  expect(items.every((item) => within(item).getByText("Не сопоставлено"))).toBe(true);
  expect(http.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Сохранить черновик" }));
  expect(await screen.findByRole("heading", { name: input.name })).toBeInTheDocument();
  const put = http.mock.calls.find(([, init]) => init?.method === "PUT")!;
  expect(JSON.parse(String(put[1]?.body))).toEqual(input);
  expect(put[1]?.credentials).toBe("include");
  expect(new Headers(put[1]?.headers).get("X-CSRF-Token")).toBe("c".repeat(42) + "A");
  await user.click(screen.getByRole("button", { name: "Удалить черновик" }));
  expect(http.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Подтвердить удаление" }));
  expect(await screen.findByText("Нет сохранённых черновиков.")).toBeInTheDocument();
  expect(http.mock.calls.filter(([url, init]) => String(url).startsWith(route) && init?.method === "GET").every(([, init]) => init?.cache === "no-store")).toBe(true);
  expect(http.mock.calls.some(([url]) => /\/spotify\/|\/tracks\//.test(String(url)))).toBe(false);
});

it("retries an uncertain save only on confirmation, with the same draft ID and body", async () => {
  let attempts = 0;
  let id = "";
  const { http, user } = setup((path, init) => {
    if (path === route) return json({ imports: id ? [saved(id)] : [] });
    if (init.method === "PUT") {
      id = path.split("/").at(-1)!;
      if (++attempts === 1) return Promise.reject(new TypeError("network lost after request"));
      return json({ draft: { ...saved(id), entries } }, 200);
    }
    if (path === `${route}/${id}` && id) return json({ draft: { ...saved(id), entries } });
    throw new Error(`Unexpected request: ${path}`);
  });
  await review(user);
  await user.click(screen.getByRole("button", { name: "Сохранить черновик" }));
  expect(await screen.findByRole("alert")).not.toHaveTextContent("network lost");
  expect(attempts).toBe(1);
  await user.click(screen.getByRole("button", { name: "Сохранить черновик" }));
  await screen.findByRole("heading", { name: input.name });
  const puts = http.mock.calls.filter(([, init]) => init?.method === "PUT");
  expect(puts).toHaveLength(2);
  expect(puts[0][0]).toBe(puts[1][0]);
  expect(puts[0][1]?.body).toBe(puts[1][1]?.body);
});

it.each([
  ["import_conflict", "Этот черновик уже существует с другим содержимым."],
  ["import_limit", "Достигнут лимит черновиков."],
])("keeps review and reports %s without treating it as revoked access", async (code, message) => {
  const { user } = setup((path, init) => {
    if (path === route) return json({ imports: [] });
    if (init.method === "PUT") return json({ error: code }, 409);
    throw new Error(`Unexpected request: ${path}`);
  });
  await review(user);
  await user.click(screen.getByRole("button", { name: "Сохранить черновик" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(screen.getByRole("heading", { name: "Проверка импорта" })).toBeInTheDocument();
});

it("discards rejected files and hides a reviewed draft after revocation", async () => {
  const { http, user, revoke } = setup((path) => {
    if (path === route) return json({ imports: [] });
    throw new Error(`Unexpected request: ${path}`);
  });
  await user.upload(await screen.findByLabelText("Файл экспорта TF"), exportFile([{ ...entries[0], media: "must-not-echo" }]));
  expect(await screen.findByRole("alert")).not.toHaveTextContent("must-not-echo");
  expect(screen.queryByRole("button", { name: "Сохранить черновик" })).not.toBeInTheDocument();
  await review(user);
  revoke();
  await user.click(screen.getByRole("button", { name: "Refresh access" }));
  expect(await screen.findByText("Черновики импорта недоступны для этого аккаунта.")).toBeInTheDocument();
  expect(screen.queryByText("Quiet Hours")).not.toBeInTheDocument();
  expect(http.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
});

it("aborts stale detail on installation change and never displays the old draft in the new scope", async () => {
  const id = "10000000-0000-4000-8000-000000000002";
  let finish!: (response: Response) => void;
  let firstInstallation = true;
  const { http, user, switchInstallation } = setup((path) => {
    if (path === route) return json({ imports: firstInstallation ? [saved(id, "Old draft")] : [] });
    if (path === `${route}/${id}`) return new Promise((resolve) => { finish = resolve; });
    throw new Error(`Unexpected request: ${path}`);
  });
  await user.click(await screen.findByRole("button", { name: /Old draft/ }));
  const signal = () => http.mock.calls.find(([path]) => path === `${route}/${id}`)?.[1]?.signal;
  await waitFor(() => expect(signal()?.aborted).toBe(false));
  firstInstallation = false;
  switchInstallation();
  await user.click(screen.getByRole("button", { name: "Refresh access" }));
  await waitFor(() => expect(signal()?.aborted).toBe(true));
  await act(async () => finish(json({ draft: { ...saved(id, "Old draft"), entries } })));
  expect(await screen.findByText("Нет сохранённых черновиков.")).toBeInTheDocument();
  expect(screen.queryByText("Quiet Hours")).not.toBeInTheDocument();
});

it("reviews offline Spotify ranges with collections-only access and saves just the chosen normalized rows", async () => {
  const archiveName = "Любимые Spotify из файла (201–203)";
  const entry = { artist: "Archive Artist", title: "Archive Track", durationSeconds: null };
  const archiveEntries = [entry, entry];
  let id: string | null = null;
  const summary = () => ({ ...saved(id!, archiveName), entryCount: archiveEntries.length });
  const { http, user } = setup((path, init) => {
    if (path === route) return json({ imports: id ? [summary()] : [] });
    if (path.startsWith(`${route}/`) && init.method === "PUT") {
      id = path.split("/").at(-1)!;
      return json({ draft: { ...summary(), entries: archiveEntries } }, 201);
    }
    if (path === `${route}/${id}` && id) return json({ draft: { ...summary(), entries: archiveEntries } });
    throw new Error(`Unexpected request: ${path}`);
  });
  const archive = await reviewSpotify(user, [...Array(200).fill(null), archiveSong, null, archiveSong]);
  const next = () => archive.getByRole("button", { name: "Следующий диапазон" });
  const previous = () => archive.getByRole("button", { name: "Предыдущий диапазон" });
  const puts = () => http.mock.calls.filter(([, init]) => init?.method === "PUT");

  expect(archive.getByText("Позиции 1–200 из 203")).toBeInTheDocument();
  expect(archive.getByText(/Пропущено: 200/)).toBeInTheDocument();
  expect(archive.queryByRole("button", { name: "Сохранить черновик" })).not.toBeInTheDocument();
  expect(previous()).toBeDisabled();
  await user.click(next());
  expect(archive.getByText("Позиции 201–203 из 203")).toBeInTheDocument();
  expect(archive.getByText(/Пропущено: 1/)).toBeInTheDocument();
  expect(archive.getAllByText("Archive Track")).toHaveLength(2);
  expect(next()).toBeDisabled();
  await user.click(previous());
  expect(archive.getByText("Позиции 1–200 из 203")).toBeInTheDocument();
  await user.click(next());
  expect(puts()).toHaveLength(0);
  expect(archive.queryByText(/private-account|private-album|private-audio|spotify:track/)).not.toBeInTheDocument();
  await user.click(archive.getByRole("button", { name: "Сохранить черновик" }));
  expect(await screen.findByRole("heading", { name: archiveName })).toBeInTheDocument();
  expect(puts()).toHaveLength(1);
  expect(JSON.parse(String(puts()[0][1]?.body))).toEqual({
    name: archiveName, source: "file", entries: archiveEntries,
  });
  expect(http.mock.calls.map(([url]) => String(url)).every((path) =>
    path === "/api/auth/me" || path === route || path === `${route}/${id}`)).toBe(true);
});

it("keeps navigation out of an oversized Spotify range without exposing its rows or saving it", async () => {
  const { http, user } = setup((path) => {
    if (path === route) return json({ imports: [] });
    throw new Error(`Unexpected request: ${path}`);
  });
  const oversizedSong = { ...archiveSong, artist: "я".repeat(300), track: "ю".repeat(500) };
  const archive = await reviewSpotify(user, [...Array(200).fill(oversizedSong), archiveSong]);
  expect(archive.getByText("Позиции 1–200 из 201")).toBeInTheDocument();
  expect(archive.getByRole("alert")).toHaveTextContent("90 КиБ");
  expect(archive.queryByText(oversizedSong.track)).not.toBeInTheDocument();
  expect(archive.queryByRole("button", { name: "Сохранить черновик" })).not.toBeInTheDocument();
  await user.click(archive.getByRole("button", { name: "Следующий диапазон" }));
  expect(archive.getByText("Позиции 201–201 из 201")).toBeInTheDocument();
  expect(archive.getByText("Archive Track")).toBeInTheDocument();
  expect(archive.queryByRole("alert")).not.toBeInTheDocument();
  expect(http.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
});

it("clears Spotify review on cancel or installation change and never presents an empty archive as a range", async () => {
  const { http, user, switchInstallation } = setup((path) => {
    if (path === route) return json({ imports: [] });
    throw new Error(`Unexpected request: ${path}`);
  });
  const empty = await reviewSpotify(user, []);
  expect(empty.getByText("В файле нет сохранённых треков Spotify.")).toBeInTheDocument();
  expect(empty.queryByText(/Позиции/)).not.toBeInTheDocument();
  expect(empty.queryByRole("button", { name: "Сохранить черновик" })).not.toBeInTheDocument();
  await user.click(empty.getByRole("button", { name: "Отмена" }));
  expect(screen.queryByRole("region", { name: "Проверка импорта" })).not.toBeInTheDocument();

  const loaded = await reviewSpotify(user, [archiveSong]);
  expect(loaded.getByText("Archive Track")).toBeInTheDocument();
  switchInstallation();
  await user.click(screen.getByRole("button", { name: "Refresh access" }));
  await waitFor(() => expect(screen.queryByText("Archive Track")).not.toBeInTheDocument());
  expect(screen.queryByRole("region", { name: "Проверка импорта" })).not.toBeInTheDocument();
  expect(http.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
});

it("chooses one of two identically named playlists and scopes the saved range to its collection index", async () => {
  const name = "Shared playlist (201–201)";
  const entry = { artist: "Archive Artist", title: "Second playlist track", durationSeconds: null };
  let draftId: string | null = null;
  let finishSave!: (response: Response) => void;
  const summary = () => ({ ...saved(draftId!, name), entryCount: 1 });
  const { http, user } = setup((path, init) => {
    if (path === route) return json({ imports: draftId ? [summary()] : [] });
    if (path.startsWith(`${route}/`) && init.method === "PUT") {
      draftId = path.split("/").at(-1)!;
      return new Promise((resolve) => { finishSave = resolve; });
    }
    if (draftId && path === `${route}/${draftId}`) return json({ draft: { ...summary(), entries: [entry] } });
    throw new Error(`Unexpected request: ${path}`);
  });
  const archive = await reviewSpotifyFile(user, spotifyPlaylistFile([
    { name: "Shared playlist", items: [...Array(200).fill(null), playlistItem("First playlist track")] },
    { name: "Shared playlist", items: [...Array(200).fill(null), playlistItem("Second playlist track")] },
  ]));
  const chooser = archive.getByRole("combobox", { name: "Плейлист Spotify" });
  const next = () => archive.getByRole("button", { name: "Следующий диапазон" });
  const saveButton = () => archive.getByRole("button", { name: "Сохранить черновик" });
  const puts = () => http.mock.calls.filter(([, init]) => init?.method === "PUT");

  expect(chooser).toHaveValue("");
  expect(archive.queryByRole("button", { name: "Сохранить черновик" })).not.toBeInTheDocument();
  await user.selectOptions(chooser, archive.getByRole("option", { name: "2. Shared playlist" }));
  await user.click(next());
  expect(archive.getByText("Second playlist track")).toBeInTheDocument();
  expect(archive.queryByText("First playlist track")).not.toBeInTheDocument();
  expect(puts()).toHaveLength(0);
  await user.click(saveButton());
  expect(chooser).toBeDisabled();
  expect(archive.getByRole("button", { name: "Предыдущий диапазон" })).toBeDisabled();
  expect(puts()).toHaveLength(1);
  expect(JSON.parse(String(puts()[0][1]?.body))).toEqual({ name, source: "file", entries: [entry] });
  await act(async () => finishSave(json({ draft: { ...summary(), entries: [entry] } }, 201)));
  await archive.findByText("Диапазон сохранён как черновик.");

  await user.selectOptions(chooser, archive.getByRole("option", { name: "1. Shared playlist" }));
  expect(archive.getByText("Позиции 1–200 из 201")).toBeInTheDocument();
  await user.click(next());
  expect(archive.getByText("First playlist track")).toBeInTheDocument();
  expect(saveButton()).toBeEnabled();
  await user.selectOptions(chooser, archive.getByRole("option", { name: "2. Shared playlist" }));
  await user.click(next());
  expect(archive.getByText("Диапазон сохранён как черновик.")).toBeInTheDocument();
  expect(puts()).toHaveLength(1);
  expect(http.mock.calls.map(([url]) => String(url)).every((path) =>
    path === "/api/auth/me" || path === route || path === `${route}/${draftId}`)).toBe(true);
});

it("distinguishes a Spotify file with no playlists from a selected empty playlist", async () => {
  const { user } = setup((path) => {
    if (path === route) return json({ imports: [] });
    throw new Error(`Unexpected request: ${path}`);
  });
  const emptyFile = await reviewSpotifyFile(user, spotifyPlaylistFile([]));
  expect(emptyFile.getByText("В файле нет плейлистов Spotify.")).toBeInTheDocument();
  const emptyPlaylist = await reviewSpotifyFile(user, spotifyPlaylistFile([{ name: "Empty playlist", items: [] }]));
  expect(emptyPlaylist.getByText("В плейлисте нет записей.")).toBeInTheDocument();
  expect(emptyPlaylist.queryByText(/Позиции/)).not.toBeInTheDocument();
  expect(emptyPlaylist.queryByRole("button", { name: "Сохранить черновик" })).not.toBeInTheDocument();
});
