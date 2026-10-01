import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LikedTrack } from "@workspace/api-client-react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { TfAuthProvider, useTfAuth } from "@/auth/tf-auth";
import { LikedCollection } from "./LikedCollection";

const player = vi.hoisted(() => ({ playTrack: vi.fn(), playCollection: vi.fn() }));
vi.mock("@/hooks/use-player", () => ({ usePlayer: () => player }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const clients: QueryClient[] = [];
const accountA = "10000000-0000-4000-8000-000000000001";
const accountB = "10000000-0000-4000-8000-000000000002";
const tracks: LikedTrack[] = [
  {
    trackId: "yt_first", title: "First", artist: "Artist", thumbnailUrl: null,
    durationSeconds: 180, likedAt: "2026-09-04T20:00:00.000Z",
  },
  {
    trackId: "sc_second", title: "Second", artist: "Artist", thumbnailUrl: null,
    durationSeconds: null, likedAt: "2026-09-04T20:00:00.000Z",
  },
];
const json = (body: unknown) => new Response(JSON.stringify(body), {
  headers: { "Content-Type": "application/json" },
});

function fixture({ holdMove = false } = {}) {
  let account = accountA;
  let rows = [...tracks];
  let revision = 7;
  let finishMove: (() => void) | undefined;
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/auth/me")) return json({
      accountId: account,
      installationId: "20000000-0000-4000-8000-000000000001",
      entitlements: ["tf.collections"],
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      csrfToken: "c".repeat(42) + "A",
    });
    if (path.endsWith("/collections/liked/order") && init?.method === "PATCH") {
      if (holdMove) await new Promise<void>((resolve) => { finishMove = resolve; });
      const request = JSON.parse(String(init.body)) as {
        trackId: string; beforeTrackId: string | null; expectedRevision: string;
      };
      if (request.expectedRevision !== String(revision)) return new Response(
        JSON.stringify({ error: "liked_order_conflict", revision: String(revision) }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
      const source = rows.find((row) => row.trackId === request.trackId)!;
      rows = rows.filter((row) => row.trackId !== request.trackId);
      const before = request.beforeTrackId === null ? rows.length
        : rows.findIndex((row) => row.trackId === request.beforeTrackId);
      rows.splice(before, 0, source);
      return json({ revision: String(++revision) });
    }
    if (path.includes("/collections/liked?")) return json({
      items: rows, nextCursor: null, revision: String(revision),
    });
    if (path.endsWith("/playlists")) return json({ playlists: [] });
    throw new Error(`Unexpected request: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <TfAuthProvider>{children}</TfAuthProvider>
    </QueryClientProvider>
  );
  return {
    wrapper,
    fetchMock,
    finishMove: () => {
      if (!finishMove) throw new Error("No move is pending");
      finishMove();
    },
    switchAccount: () => { account = accountB; },
  };
}

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

it("keeps listening actions visible and exposes reorder controls only while editing", async () => {
  const f = fixture();
  const user = userEvent.setup();
  render(<LikedCollection />, { wrapper: f.wrapper });
  await screen.findByText("Second");

  expect(screen.queryByRole("button", { name: "Переместить First" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Поднять First" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Опустить First" })).not.toBeInTheDocument();
  expect(screen.getByText("3:00")).toBeVisible();
  expect(screen.getByLabelText("Длительность неизвестна")).toBeVisible();
  for (const title of ["First", "Second"]) {
    expect(screen.getByRole("button", { name: `Воспроизвести ${title}` })).toBeVisible();
    expect(screen.getByRole("button", { name: `Добавить ${title} в плейлист` })).toBeVisible();
    expect(screen.getByRole("button", { name: `Удалить ${title}` })).toBeVisible();
  }
  const toggle = screen.getByRole("button", { name: "Изменить порядок" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  await user.click(toggle);
  expect(screen.getByRole("button", { name: "Готово" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Переместить Second" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Поднять Second" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Опустить Second" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Воспроизвести First" }));
  expect(player.playTrack).toHaveBeenCalledWith(expect.objectContaining({ id: "yt_first" }));
  await user.click(screen.getByRole("button", { name: "Готово" }));
  expect(screen.queryByRole("button", { name: "Переместить Second" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("First");
  await user.click(screen.getByRole("button", { name: "Добавить First в плейлист" }));
  expect(await screen.findByRole("dialog", { name: "Добавить в плейлист" })).toBeVisible();
  expect(f.fetchMock.mock.calls.some(([url]) => String(url).endsWith("/collections/liked/order"))).toBe(false);
});

it("reorders from the keyboard only after opting in and retains server order on exit", async () => {
  const f = fixture();
  const user = userEvent.setup();
  render(<LikedCollection />, { wrapper: f.wrapper });
  await screen.findByText("Second");
  await user.click(screen.getByRole("button", { name: "Изменить порядок" }));
  screen.getByRole("button", { name: "Переместить Second" }).focus();
  await user.keyboard("{ArrowUp}");
  await waitFor(() => expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Second"));
  const move = f.fetchMock.mock.calls.find(([url]) => String(url).endsWith("/collections/liked/order"))!;
  expect(JSON.parse(String(move[1]?.body))).toEqual({
    trackId: "sc_second", beforeTrackId: "yt_first", expectedRevision: "7",
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "Готово" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Готово" }));
  const rows = screen.getAllByRole("listitem");
  expect(rows[0]).toHaveTextContent("Second");
  expect(rows[1]).toHaveTextContent("First");
  expect(within(rows[0]).queryByRole("button", { name: "Переместить Second" })).not.toBeInTheDocument();
});

it("cannot exit editing or repeat a move while its request is pending", async () => {
  const f = fixture({ holdMove: true });
  const user = userEvent.setup();
  render(<LikedCollection />, { wrapper: f.wrapper });
  await screen.findByText("Second");
  await user.click(screen.getByRole("button", { name: "Изменить порядок" }));
  await user.click(screen.getByRole("button", { name: "Поднять Second" }));
  const done = screen.getByRole("button", { name: "Готово" });
  await waitFor(() => expect(done).toBeDisabled());
  expect(screen.getByRole("button", { name: "Переместить Second" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Поднять Second" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Воспроизвести Second" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Добавить Second в плейлист" })).toBeEnabled();
  await user.click(done);
  expect(done).toHaveAttribute("aria-pressed", "true");
  await act(async () => { f.finishMove(); });
  await waitFor(() => expect(done).toBeEnabled());
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Second");
  await user.click(done);
  expect(screen.getByRole("button", { name: "Изменить порядок" })).toHaveAttribute("aria-pressed", "false");
});

it("resets editing on account change even when the next account has the same track IDs", async () => {
  const f = fixture();
  const user = userEvent.setup();
  function AccountSwitch() {
    const auth = useTfAuth();
    return <button type="button" onClick={() => {
      f.switchAccount();
      void auth.refresh();
    }}>Switch account</button>;
  }
  render(<><AccountSwitch /><LikedCollection /></>, { wrapper: f.wrapper });
  await screen.findByText("Second");
  await user.click(screen.getByRole("button", { name: "Изменить порядок" }));
  expect(screen.getByRole("button", { name: "Переместить Second" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Switch account" }));
  const toggle = await screen.findByRole("button", { name: "Изменить порядок" });
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  await screen.findByText("Second");
  expect(screen.queryByRole("button", { name: "Переместить Second" })).not.toBeInTheDocument();
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("First");
});
