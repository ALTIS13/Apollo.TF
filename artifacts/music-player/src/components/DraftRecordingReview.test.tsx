import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { TfAuthProvider, useTfAuth } from "@/auth/tf-auth";
import { clearTfSessionSecurityState } from "@/lib/tf-session-client";
import { PlaylistImportsCollection } from "./PlaylistImportsCollection";

const draftId = "10000000-0000-4000-8000-000000000012";
const base = "/api/collections/imports";
const draftPath = `${base}/${draftId}`;
const slot = (position: number) => `${draftPath}/entries/${position}`;
const entries = [
  { artist: "Example Artist", title: "First track", durationSeconds: null },
  { artist: "Example Artist", title: "Second track", durationSeconds: 183 },
];
const summary = { id: draftId, name: "Saved draft", source: "file", createdAt: "2026-11-12T00:00:00Z", entryCount: entries.length };
const clean = {
  id: "clean", evidenceRevision: "a".repeat(64), artist: "Example Artist", title: "Catalog clean edit",
  edition: "clean_edit", releaseDate: "2020-01-01", expectedDurationSeconds: 182, measuredDurationSeconds: 181,
  access: "full", download: "not_permitted", sourceLabel: "Catalog owner", sourceUrl: "https://example.test/recording/clean",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function RefreshSession() {
  const { refresh } = useTfAuth();
  return <button type="button" onClick={() => void refresh()}>Refresh session</button>;
}

function setup(respond: (path: string, init: RequestInit) => Response | Promise<Response>, search = true) {
  const http = vi.fn<typeof fetch>((url, init = {}) => {
    if (url === "/api/auth/me") return Promise.resolve(json({
      accountId: "10000000-0000-4000-8000-000000000001",
      installationId: "20000000-0000-4000-8000-000000000001",
      entitlements: search ? ["tf.collections", "tf.search"] : ["tf.collections"],
      expiresAt: new Date(Date.now() + 300_000).toISOString(), csrfToken: "c".repeat(42) + "A",
    }));
    if (url === base) return Promise.resolve(json({ imports: [summary] }));
    if (url === draftPath) return Promise.resolve(json({ draft: { ...summary, entries } }));
    return Promise.resolve(respond(String(url), init));
  });
  vi.stubGlobal("fetch", http);
  render(<QueryClientProvider client={new QueryClient()}><TfAuthProvider>
    <RefreshSession /><PlaylistImportsCollection />
  </TfAuthProvider></QueryClientProvider>);
  return { http, user: userEvent.setup() };
}

async function openDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /Saved draft/ }));
  await screen.findByRole("heading", { name: "Saved draft" });
}

const buttonFor = (name: string) => screen.getByRole("button", { name: new RegExp(`Подобрать запись: ${name}`) });

afterEach(() => {
  cleanup();
  clearTfSessionSecurityState();
  vi.unstubAllGlobals();
});

it("reads only the selected saved slot, compares evidence, and saves a full recording only on explicit confirmation", async () => {
  let selection: { candidateId: string; evidenceRevision: string; selectedAt: string } | null = null;
  const { user, http } = setup((path, init) => {
    if (path === `${slot(1)}/candidates`) return json({ status: "ready", selection, candidates: [
      clean,
      { ...clean, id: "sample", title: "Short preview", access: "preview", download: "permitted", sourceLabel: "Unsafe source", sourceUrl: "javascript:alert(1)" },
      { ...clean, id: "unverified", title: "Unknown access", edition: "unknown", access: "unverified", sourceUrl: null },
      { ...clean, id: "alternate", title: "Longer alternate", edition: "alternate", measuredDurationSeconds: 192 },
      { ...clean, id: "within-tolerance", title: "Minor difference", measuredDurationSeconds: 186 },
    ] });
    if (path === `${slot(1)}/selection` && init.method === "PUT") {
      selection = { ...JSON.parse(String(init.body)), selectedAt: "2026-11-12T00:00:00Z" };
      return json({ selection });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  await openDraft(user);
  expect(screen.queryByText("Не сопоставлено")).not.toBeInTheDocument();
  expect(http.mock.calls.some(([path]) => String(path).endsWith("/candidates"))).toBe(false);
  await user.click(buttonFor("Second track"));
  const panel = await screen.findByRole("region", { name: /Подбор записи: Second track/ });
  const eligible = await within(panel).findByRole("radio", { name: "Catalog clean edit" });
  expect(within(panel).getByRole("radio", { name: "Short preview" })).toBeDisabled();
  expect(within(panel).getByRole("radio", { name: "Unknown access" })).toBeDisabled();
  expect(within(panel).getByText("Версия неизвестна")).toBeInTheDocument();
  const alternate = within(panel).getByRole("radio", { name: "Longer alternate" });
  expect(within(alternate.closest("li")!).getByText("Длительность отличается на 9 с.")).toBeInTheDocument();
  expect(within(within(panel).getByRole("radio", { name: "Minor difference" }).closest("li")!).queryByText(/Длительность отличается/)).not.toBeInTheDocument();
  for (const text of ["3:03", "3:02", "3:01", "Цензурированная версия", "Скачивание не разрешено"]) {
    expect(within(panel).getAllByText(text).length).toBeGreaterThan(0);
  }
  expect(within(eligible.closest("li")!).getByRole("link", { name: "Catalog owner" })).toHaveAttribute("href", clean.sourceUrl);
  expect(within(panel).queryByRole("link", { name: "Unsafe source" })).not.toBeInTheDocument();
  const confirm = within(panel).getByRole("button", { name: "Подтвердить выбор" });
  expect(confirm).toBeDisabled();
  await user.click(alternate);
  expect(alternate).toBeChecked();
  expect(confirm).toBeEnabled();
  await user.click(eligible);
  expect(http.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  await user.click(confirm);
  expect(await within(panel).findByText("Сохранённый выбор: Catalog clean edit")).toBeInTheDocument();
  const get = http.mock.calls.find(([path]) => path === `${slot(1)}/candidates`);
  const put = http.mock.calls.find(([path]) => path === `${slot(1)}/selection`);
  expect(get?.[1]).toMatchObject({ method: "GET", cache: "no-store", credentials: "include" });
  expect(put?.[1]).toMatchObject({ method: "PUT", cache: "no-store", credentials: "include" });
  expect(JSON.parse(String(put?.[1]?.body))).toEqual({ candidateId: "clean", evidenceRevision: clean.evidenceRevision });
  expect(new Headers(put?.[1]?.headers).get("X-CSRF-Token")).toBe("c".repeat(42) + "A");
  await user.click(buttonFor("Second track"));
  await user.click(buttonFor("Second track"));
  expect(await screen.findByText("Сохранённый выбор: Catalog clean edit")).toBeInTheDocument();
  expect(http.mock.calls.some(([path]) => /\/tracks\/|\/download\b/.test(String(path)))).toBe(false);
});

it.each(["old-revision", "missing-candidate"])("marks a durable %s selection as stale", async (kind) => {
  const { user } = setup(() => json({
    status: "ready", candidates: [clean],
    selection: { candidateId: kind === "old-revision" ? clean.id : "missing", evidenceRevision: "b".repeat(64), selectedAt: "2026-11-12T00:00:00Z" },
  }));
  await openDraft(user);
  await user.click(buttonFor("First track"));
  expect(await screen.findByText("Сохранённый выбор устарел.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Подтвердить выбор" })).toBeDisabled();
});

it("aborts row changes and session refreshes, ignoring replies that arrive after cancellation", async () => {
  let finishFirst!: (response: Response) => void;
  let finishSecond!: (response: Response) => void;
  const { user, http } = setup((path) => {
    if (path === `${slot(0)}/candidates`) return new Promise((resolve) => { finishFirst = resolve; });
    if (path === `${slot(1)}/candidates`) return new Promise((resolve) => { finishSecond = resolve; });
    throw new Error(`Unexpected request: ${path}`);
  });
  const signal = (position: number) => http.mock.calls.find(([path]) => path === `${slot(position)}/candidates`)?.[1]?.signal;
  await openDraft(user);
  await user.click(buttonFor("First track"));
  await waitFor(() => expect(signal(0)?.aborted).toBe(false));
  await user.click(buttonFor("Second track"));
  expect(signal(0)?.aborted).toBe(true);
  await act(async () => finishFirst(json({ status: "ready", candidates: [clean], selection: null })));
  expect(screen.queryByText(clean.title)).not.toBeInTheDocument();
  await waitFor(() => expect(signal(1)?.aborted).toBe(false));
  await user.click(screen.getByRole("button", { name: "Refresh session" }));
  await waitFor(() => expect(signal(1)?.aborted).toBe(true));
  await act(async () => finishSecond(json({ status: "ready", candidates: [clean], selection: null })));
  expect(screen.queryByRole("region", { name: /Подбор записи:/ })).not.toBeInTheDocument();
});

it("shows a retry for a failed read and an explicit unconfigured state", async () => {
  let reads = 0;
  const { user } = setup(() => ++reads === 1
    ? json({ error: "recording_catalog_unavailable", detail: "private transport detail" }, 503)
    : json({ status: "unconfigured", candidates: [], selection: null }));
  await openDraft(user);
  await user.click(buttonFor("First track"));
  expect(await screen.findByRole("alert")).not.toHaveTextContent("private transport detail");
  await user.click(screen.getByRole("button", { name: "Повторить" }));
  expect(await screen.findByText("Каталог проверенных записей не настроен.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Подтвердить выбор" })).not.toBeInTheDocument();
});

it("keeps a rejected save local and requires fresh evidence before another confirmation", async () => {
  let reads = 0;
  const { user } = setup((path) => {
    if (path === `${slot(0)}/candidates`) return json({ status: "ready", selection: null, candidates: [
      { ...clean, evidenceRevision: (++reads === 1 ? "a" : "b").repeat(64) },
    ] });
    if (path === `${slot(0)}/selection`) return json({ error: "recording_selection_changed" }, 409);
    throw new Error(`Unexpected request: ${path}`);
  });
  await openDraft(user);
  await user.click(buttonFor("First track"));
  await user.click(await screen.findByRole("radio", { name: clean.title }));
  await user.click(screen.getByRole("button", { name: "Подтвердить выбор" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Данные о записи изменились.");
  expect(screen.getByRole("radio", { name: clean.title })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Обновить варианты" }));
  expect(await screen.findByRole("radio", { name: clean.title })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Подтвердить выбор" })).toBeDisabled();
  expect(reads).toBe(2);
});

it("offers no search on unsaved file rows, or on saved rows without tf.search", async () => {
  const fixture = setup((path) => { throw new Error(`Unexpected request: ${path}`); });
  const file = new File([JSON.stringify({ schemaVersion: "apollo.tf.playlist-export.v1", playlist: { name: "Unsaved", description: null }, tracks: entries })], "export.json", { type: "application/json" });
  await fixture.user.upload(await screen.findByLabelText("Файл экспорта TF"), file);
  const review = await screen.findByRole("region", { name: "Проверка импорта" });
  expect(within(review).queryByRole("button", { name: /Подобрать запись/ })).not.toBeInTheDocument();
  cleanup();
  clearTfSessionSecurityState();
  const { user, http } = setup((path) => { throw new Error(`Unexpected request: ${path}`); }, false);
  await openDraft(user);
  expect(screen.queryByRole("button", { name: /Подобрать запись/ })).not.toBeInTheDocument();
  expect(http.mock.calls.some(([path]) => String(path).includes("/entries/"))).toBe(false);
});
