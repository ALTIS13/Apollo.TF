import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { TrackResult } from "@workspace/api-client-react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TfAuthProvider, useTfAuth } from "@/auth/tf-auth";
import { TfSessionBoundary } from "@/auth/TfSessionBoundary";
import {
  clearTfSessionSecurityState,
  suspendTfProtectedActivity,
  TfApiError,
  type TfBrowserSession,
} from "@/lib/tf-session-client";
import Discover from "./Discover";

vi.mock("@/hooks/use-player", () => ({
  usePlayer: () => ({
    currentTrack: null, isPlaying: false, isLoading: false,
    playTrack: vi.fn(), togglePlayPause: vi.fn(),
    addToQueue: vi.fn(), addNextToQueue: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const track: TrackResult = {
  id: "yt_saved-artist-track", title: "New Track", artist: "Saved Artist",
  source: "youtube", type: "original", duration: 180,
  thumbnailUrl: null, quality: ["128"], score: 90,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const recommendationRequest = vi.fn<(init?: RequestInit) => Promise<Response>>();
const preferenceRequest = vi.fn<(init?: RequestInit) => Promise<Response>>();
const clients: QueryClient[] = [];
let session: TfBrowserSession;

beforeEach(() => {
  clearTfSessionSecurityState();
  session = {
    accountId: "10000000-0000-4000-8000-000000000001",
    installationId: "20000000-0000-4000-8000-000000000001",
    entitlements: ["tf.search", "tf.collections"],
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    csrfToken: "c".repeat(42) + "A",
  };
  recommendationRequest.mockResolvedValue(json({ basis: "none", results: [] }));
  preferenceRequest.mockImplementation(async () => json({ schemaVersion: 1, status: "hidden" }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith("/auth/me")) return json(session);
    if (path.includes("/tracks/recommendations?")) return recommendationRequest(init);
    if (path.includes("/tracks/recommendations/hidden")) return preferenceRequest(init);
    if (path.endsWith("/collections/liked/lookup")) return json({ likedTrackIds: [] });
    throw new Error(`Unexpected request: ${path}`);
  }));
});

function SessionReady({ children }: { children: ReactNode }) {
  const { status } = useTfAuth();
  return status === "loading" ? null : <>{children}</>;
}

function renderDiscover(children: ReactNode = <Discover />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const location = memoryLocation({ path: "/discover" });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <TfAuthProvider><Router hook={location.hook}><SessionReady>{children}</SessionReady></Router></TfAuthProvider>
    </QueryClientProvider>
  );
  return render(children, { wrapper });
}

function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  clearTfSessionSecurityState();
  vi.unstubAllGlobals();
  recommendationRequest.mockReset();
  preferenceRequest.mockReset();
});

it("labels recommendations from saved tracks without claiming a listening history", async () => {
  recommendationRequest.mockResolvedValue(json({ basis: "liked_tracks", results: [track] }));
  renderDiscover();

  expect(
    await screen.findByText("По вашим сохранённым трекам"),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("На основе вашей истории прослушиваний"),
  ).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("heading", { name: "New Track" })).toBeVisible());
  expect(screen.getByRole("button", { name: "Сохранить в избранное" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Добавить New Track в плейлист" })).toBeVisible();
});

it("keeps a neutral label for an unknown recommendation basis", async () => {
  recommendationRequest.mockResolvedValue(json({ basis: "toString", results: [] }));
  renderDiscover();

  await screen.findByText("Пока нет рекомендаций");
  expect(screen.getByText("Подборка для вас")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "К поиску" })).toHaveAttribute("href", "/");
});

it("retries a network failure locally and renders fresh results without exposing error details", async () => {
  const user = userEvent.setup();
  const retry = pendingResponse();
  recommendationRequest.mockRejectedValueOnce(new TypeError("private_network_detail"))
    .mockReturnValueOnce(retry.promise);
  renderDiscover(<TfSessionBoundary><Discover /></TfSessionBoundary>);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Не удалось загрузить рекомендации.");
  expect(screen.queryByText(/private_network_detail|transport_unavailable/)).not.toBeInTheDocument();
  await user.click(within(alert).getByRole("button", { name: "Повторить" }));
  expect(await screen.findByRole("status", { name: "Загрузка рекомендаций" })).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => { retry.resolve(json({ basis: "mixed", results: [track] })); });
  await waitFor(() => expect(screen.getByRole("heading", { name: "New Track" })).toBeVisible());
  expect(screen.getByText("По любимому и истории прослушивания")).toBeVisible();
  expect(screen.queryByRole("status", { name: "Загрузка рекомендаций" })).not.toBeInTheDocument();
  expect(recommendationRequest).toHaveBeenCalledTimes(2);
});

it("keeps an active download polling and cancellable across same-owner token rotation without refetching", async () => {
  const user = userEvent.setup();
  const rotated = vi.fn();
  const jobId = "job-token-rotation";
  const queueRequest = vi.fn(async () => json({ results: [{ trackId: track.id, jobId, position: 1 }] }));
  const statusRequest = vi.fn<() => Promise<Response>>()
    .mockResolvedValueOnce(json({ status: "active", progress: 35 }))
    .mockImplementation(async () => json({ status: "active", progress: 64 }));
  const cancelRequest = vi.fn(async (_init?: RequestInit) => json({ jobId, status: "canceled" }));
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input);
    if (path.endsWith("/tracks/download/queue")) return queueRequest();
    if (path.endsWith(`/tracks/download/status/${jobId}`)) return statusRequest();
    if (path.endsWith(`/tracks/download/jobs/${jobId}`)) return cancelRequest(init);
    return originalFetch(input, init);
  });
  const seed = { basis: "liked_tracks", artist: "Saved Artist" };
  const other = { ...track, id: "yt_other", title: "Other Track", recommendationReason: seed };
  const selection = { basis: "liked_tracks", hiddenCount: 0, results: [other, { ...track, recommendationReason: seed }] };
  recommendationRequest.mockResolvedValueOnce(json(selection))
    .mockRejectedValue(new TypeError("renewal_must_not_refetch"));
  function RotateToken() {
    const auth = useTfAuth();
    return <button type="button" onClick={() => {
      session = { ...session, csrfToken: "d".repeat(42) + "A", entitlements: [...session.entitlements].reverse() };
      void auth.refresh().then(rotated);
    }}>Rotate token</button>;
  }
  renderDiscover(<><RotateToken /><Discover /></>);
  const heading = await screen.findByRole("heading", { name: track.title });
  await user.click(within(screen.getByRole("article", { name: track.title })).getByRole("button", { name: "Скачать" }));
  await screen.findByRole("status", { name: "Загрузка 35%" });
  const cancel = screen.getByRole("button", { name: "Отменить загрузку" });

  await user.click(screen.getByRole("button", { name: "Не рекомендовать Other Track" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Other Track" })).toBeNull());
  expect(heading).toBeInTheDocument();
  expect(cancel).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Rotate token" }));
  await waitFor(() => expect(rotated).toHaveBeenCalledOnce());
  expect(heading).toBeInTheDocument();
  expect(cancel).toBeInTheDocument();
  expect(screen.getByText("По вашим сохранённым трекам")).toBeInTheDocument();
  expect(recommendationRequest).toHaveBeenCalledOnce();
  await screen.findByRole("status", { name: "Загрузка 64%" });
  expect(statusRequest.mock.calls.length).toBeGreaterThanOrEqual(2);

  const undoRefresh = pendingResponse();
  preferenceRequest.mockResolvedValueOnce(json({ schemaVersion: 1, status: "restored" }));
  recommendationRequest.mockReturnValueOnce(undoRefresh.promise);
  await user.click(screen.getByRole("button", { name: "Отменить скрытие" }));
  await waitFor(() => expect(recommendationRequest).toHaveBeenCalledTimes(2));
  expect(heading).toBeInTheDocument();
  expect(cancel).toBeInTheDocument();
  await act(async () => { undoRefresh.resolve(json(selection)); });
  await screen.findByRole("heading", { name: "Other Track" });
  expect(heading).toBeInTheDocument();
  expect(cancel).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Не рекомендовать Other Track" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Other Track" })).toBeNull());
  preferenceRequest.mockResolvedValueOnce(json({ schemaVersion: 1, status: "cleared" }));
  const resetRefresh = pendingResponse();
  recommendationRequest.mockReturnValueOnce(resetRefresh.promise);
  await user.click(screen.getByRole("button", { name: "Сбросить скрытые рекомендации" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Сбросить" }));
  await waitFor(() => expect(recommendationRequest).toHaveBeenCalledTimes(3));
  expect(heading).toBeInTheDocument();
  expect(cancel).toBeInTheDocument();
  await act(async () => { resetRefresh.resolve(json(selection)); });
  await screen.findByRole("heading", { name: "Other Track" });
  expect(heading).toBeInTheDocument();
  expect(cancel).toBeInTheDocument();

  await user.click(cancel);
  await screen.findByRole("status", { name: "Загрузка отменена" });
  expect(queueRequest).toHaveBeenCalledOnce();
  expect(cancelRequest).toHaveBeenCalledOnce();
  const cancellation = cancelRequest.mock.calls[0][0];
  expect(cancellation?.method).toBe("DELETE");
  expect(new Headers(cancellation?.headers).get("X-CSRF-Token")).toBe(session.csrfToken);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  act(() => { suspendTfProtectedActivity(new TfApiError(403, "policy_revoked", "forbidden")); });
  expect(heading).not.toBeInTheDocument();
  expect(screen.queryByText("По вашим сохранённым трекам")).not.toBeInTheDocument();
});

it("restarts a pending recommendation request after same-owner token rotation and ignores its obsolete response", async () => {
  const pending = pendingResponse();
  const replacement = { ...track, id: "yt_fresh", title: "Fresh Track" };
  recommendationRequest.mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(json({ basis: "mixed", results: [replacement] }));
  function RotateToken() {
    const auth = useTfAuth();
    return <button type="button" onClick={() => {
      session = { ...session, csrfToken: "d".repeat(42) + "A" };
      void auth.refresh();
    }}>Rotate token</button>;
  }
  const user = userEvent.setup();
  renderDiscover(<><RotateToken /><Discover /></>);
  await waitFor(() => expect(recommendationRequest).toHaveBeenCalledOnce());
  const signal = recommendationRequest.mock.calls[0][0]?.signal;
  await user.click(screen.getByRole("button", { name: "Rotate token" }));
  await screen.findByRole("heading", { name: "Fresh Track" });
  expect(signal?.aborted).toBe(true);
  await act(async () => { pending.resolve(json({ basis: "liked_tracks", results: [track] })); });
  expect(screen.getByRole("heading", { name: "Fresh Track" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: track.title })).not.toBeInTheDocument();
  expect(recommendationRequest).toHaveBeenCalledTimes(2);
});

it.each([
  ["account", { accountId: "10000000-0000-4000-8000-000000000002" }],
  ["installation", { installationId: "20000000-0000-4000-8000-000000000002" }],
  ["added entitlement", { entitlements: ["tf.search", "tf.collections", "tf.download"] }],
] as const)("discards loaded cards when the %s changes without relying on the shell", async (_name, change) => {
  const pending = pendingResponse();
  recommendationRequest.mockResolvedValueOnce(json({ basis: "liked_tracks", results: [track] }))
    .mockReturnValueOnce(pending.promise);
  function ChangeOwner() {
    const auth = useTfAuth();
    return <button type="button" onClick={() => {
      session = { ...session, ...change, entitlements: [...("entitlements" in change ? change.entitlements : session.entitlements)] };
      void auth.refresh();
    }}>Change owner</button>;
  }
  const user = userEvent.setup();
  renderDiscover(<><ChangeOwner /><Discover /></>);
  const heading = await screen.findByRole("heading", { name: track.title });
  await user.click(screen.getByRole("button", { name: "Change owner" }));
  await waitFor(() => expect(recommendationRequest).toHaveBeenCalledTimes(2));
  expect(heading).not.toBeInTheDocument();
  expect(screen.queryByText("По вашим сохранённым трекам")).not.toBeInTheDocument();
  await act(async () => { pending.resolve(json({ basis: "none", results: [track] })); });
  expect(await screen.findByRole("heading", { name: track.title })).not.toBe(heading);
});

it("aborts a pending recommendation request when the page unmounts", async () => {
  const pending = pendingResponse();
  recommendationRequest.mockReturnValueOnce(pending.promise);
  const view = renderDiscover();
  await waitFor(() => expect(recommendationRequest).toHaveBeenCalledOnce());
  const signal = recommendationRequest.mock.calls[0][0]?.signal;
  expect(signal).toBeInstanceOf(AbortSignal);
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => { pending.resolve(json({ basis: "liked_tracks", results: [track] })); });
  expect(screen.queryByRole("heading", { name: "New Track" })).not.toBeInTheDocument();
});

it("cancels the previous account request and keeps its late failure out of the replacement account", async () => {
  const pending = pendingResponse();
  const replacement = { ...track, id: "sc_replacement", title: "Replacement Track" };
  recommendationRequest.mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(json({ basis: "listening_history", results: [replacement] }));
  function SwitchAccount() {
    const auth = useTfAuth();
    return <button type="button" onClick={() => {
      session = { ...session, accountId: "10000000-0000-4000-8000-000000000002" };
      void auth.refresh();
    }}>Switch account</button>;
  }
  const user = userEvent.setup();
  renderDiscover(<><SwitchAccount /><Discover /></>);
  await waitFor(() => expect(recommendationRequest).toHaveBeenCalledOnce());
  const signal = recommendationRequest.mock.calls[0][0]?.signal;
  await user.click(screen.getByRole("button", { name: "Switch account" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Replacement Track" })).toBeVisible());
  expect(signal?.aborted).toBe(true);
  await act(async () => { pending.resolve(json({ error: "unauthorized" }, 401)); });
  expect(screen.getByRole("heading", { name: "Replacement Track" })).toBeVisible();
  expect(screen.getByText("По вашей истории прослушивания")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(/unauthorized/)).not.toBeInTheDocument();
});

it("aborts on security suspension and cannot publish the obsolete response", async () => {
  const pending = pendingResponse();
  recommendationRequest.mockReturnValueOnce(pending.promise);
  renderDiscover();
  await waitFor(() => expect(recommendationRequest).toHaveBeenCalledOnce());
  const signal = recommendationRequest.mock.calls[0][0]?.signal;
  act(() => { suspendTfProtectedActivity(new TfApiError(403, "policy_revoked", "forbidden")); });
  expect(signal?.aborted).toBe(true);
  await act(async () => { pending.resolve(json({ basis: "liked_tracks", results: [track] })); });
  expect(screen.queryByRole("heading", { name: "New Track" })).not.toBeInTheDocument();
  expect(screen.queryByText("По вашим сохранённым трекам")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Повторить" })).not.toBeInTheDocument();
});

it("keeps API 503 failure behind the shared unavailable boundary", async () => {
  recommendationRequest.mockResolvedValueOnce(json({ error: "policy_unavailable" }, 503));
  renderDiscover(<TfSessionBoundary><Discover /></TfSessionBoundary>);

  expect(await screen.findByRole("heading", { name: "Сервис временно недоступен" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Рекомендации" })).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(recommendationRequest).toHaveBeenCalledOnce();
});

it("explains each actual recommendation seed and leaves legacy candidates neutral", async () => {
  const user = userEvent.setup();
  recommendationRequest.mockResolvedValue(json({ basis: "mixed", hiddenCount: 0, results: [
    { ...track, recommendationReason: { basis: "liked_tracks", artist: "Seed From Favorites" } },
    { ...track, id: "sc_history", title: "History Track", recommendationReason: { basis: "listening_history", artist: "History Seed" } },
    { ...track, id: "sc_legacy", title: "Legacy Track" },
  ] }));
  renderDiscover();
  await screen.findByRole("heading", { name: "New Track" });
  expect(screen.getByText("Из любимого · Seed From Favorites")).toBeVisible();
  expect(screen.getByText("Вы слушали · History Seed")).toBeVisible();
  expect(within(screen.getByRole("article", { name: "Legacy Track" })).queryByText(/Из любимого|Вы слушали/)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Не рекомендовать New Track" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "New Track" })).toBeNull());
  expect(screen.getByText("Подборка для вас")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Не рекомендовать Legacy Track" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Legacy Track" })).toBeNull());
  expect(screen.getByText("По вашей истории прослушивания")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Не рекомендовать History Track" }));
  await screen.findByText("Пока нет рекомендаций");
  expect(screen.getByText("Подборка для вас")).toBeVisible();
});

it("hides only after durable success and restores through an authenticated undo", async () => {
  const user = userEvent.setup();
  const pending = pendingResponse();
  preferenceRequest.mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(json({ schemaVersion: 1, status: "restored" }));
  recommendationRequest.mockImplementation(async () => json({ basis: "liked_tracks", hiddenCount: 0, results: [track] }));
  renderDiscover();
  const hide = await screen.findByRole("button", { name: "Не рекомендовать New Track" });
  await user.click(hide);
  expect(hide).toBeDisabled();
  expect(screen.getByRole("heading", { name: "New Track" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Отменить скрытие" })).toBeNull();
  await act(async () => { pending.resolve(json({ schemaVersion: 1, status: "hidden" })); });
  expect(screen.queryByRole("heading", { name: "New Track" })).toBeNull();
  expect(screen.getByText("Скрыто записей: 1")).toBeVisible();
  const [url, init] = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).includes("/hidden/") && init?.method === "PUT")!;
  expect(String(url)).toContain(`/recommendations/hidden/${track.id}`);
  expect(init?.credentials).toBe("include");
  expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe(session.csrfToken);
  await user.click(screen.getByRole("button", { name: "Отменить скрытие" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "New Track" })).toBeVisible());
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith(`/hidden/${track.id}`) && init?.method === "DELETE")).toBe(true);
  expect(screen.queryByRole("button", { name: "Отменить скрытие" })).toBeNull();
});

it("retains the recommendation on write failure and allows a retry without leaking details", async () => {
  const user = userEvent.setup();
  preferenceRequest.mockRejectedValueOnce(new Error("private_database_detail"));
  recommendationRequest.mockResolvedValue(json({ basis: "liked_tracks", hiddenCount: 0, results: [track] }));
  renderDiscover();
  await user.click(await screen.findByRole("button", { name: "Не рекомендовать New Track" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить настройку рекомендаций.");
  expect(screen.queryByText(/private_database_detail/)).toBeNull();
  expect(screen.getByRole("heading", { name: "New Track" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Не рекомендовать New Track" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "New Track" })).toBeNull());
});

it("requires confirmation before resetting account exclusions then reloads the selection", async () => {
  const user = userEvent.setup();
  recommendationRequest.mockResolvedValueOnce(json({ basis: "none", hiddenCount: 3, results: [] }))
    .mockResolvedValueOnce(json({ basis: "liked_tracks", hiddenCount: 0, results: [track] }));
  preferenceRequest.mockResolvedValue(json({ schemaVersion: 1, status: "cleared" }));
  renderDiscover();
  await user.click(await screen.findByRole("button", { name: "Сбросить скрытые рекомендации" }));
  const dialog = screen.getByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Отмена" }));
  expect(preferenceRequest).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Сбросить скрытые рекомендации" }));
  await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Сбросить" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "New Track" })).toBeVisible());
  expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith("/recommendations/hidden") && init?.method === "DELETE")).toBe(true);
  expect(screen.queryByText("Скрыто записей: 3")).toBeNull();
});

it("aborts pending preference writes on suspension and drops late feedback", async () => {
  const user = userEvent.setup();
  const pending = pendingResponse();
  preferenceRequest.mockReturnValue(pending.promise);
  recommendationRequest.mockResolvedValue(json({ basis: "liked_tracks", hiddenCount: 0, results: [track] }));
  renderDiscover();
  await user.click(await screen.findByRole("button", { name: "Не рекомендовать New Track" }));
  const signal = preferenceRequest.mock.calls[0][0]?.signal;
  act(() => { suspendTfProtectedActivity(new TfApiError(403, "policy_revoked", "forbidden")); });
  expect(signal?.aborted).toBe(true);
  await act(async () => { pending.resolve(json({ schemaVersion: 1, status: "hidden" })); });
  expect(screen.queryByRole("button", { name: "Отменить скрытие" })).toBeNull();
  expect(screen.queryByText(/Запись скрыта/)).toBeNull();
});

it("does not apply the previous owner's pending hide to the replacement account", async () => {
  const pending = pendingResponse();
  preferenceRequest.mockReturnValueOnce(pending.promise);
  recommendationRequest.mockImplementation(async () => json({ basis: "liked_tracks", hiddenCount: 0, results: [track] }));
  function SwitchOwner() {
    const auth = useTfAuth();
    return <button onClick={() => {
      session = { ...session, accountId: "10000000-0000-4000-8000-000000000002" };
      void auth.refresh();
    }}>Switch preference owner</button>;
  }
  const user = userEvent.setup();
  renderDiscover(<><SwitchOwner /><Discover /></>);
  await user.click(await screen.findByRole("button", { name: "Не рекомендовать New Track" }));
  const signal = preferenceRequest.mock.calls[0][0]?.signal;
  await user.click(screen.getByRole("button", { name: "Switch preference owner" }));
  await waitFor(() => expect(recommendationRequest).toHaveBeenCalledTimes(2));
  await screen.findByRole("heading", { name: "New Track" });
  expect(signal?.aborted).toBe(true);
  await act(async () => { pending.resolve(json({ schemaVersion: 1, status: "hidden" })); });
  expect(screen.getByRole("heading", { name: "New Track" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Отменить скрытие" })).toBeNull();
});

it("requires both search and collections access before exposing recommendations", async () => {
  session = { ...session, entitlements: ["tf.search"] };
  renderDiscover();
  expect(await screen.findByText("Рекомендации недоступны для этого аккаунта.")).toBeVisible();
  expect(recommendationRequest).not.toHaveBeenCalled();
});

it("reconciles a committed pending hide under the current token without publishing stale feedback", async () => {
  const user = userEvent.setup();
  const pending = pendingResponse();
  const rotated = vi.fn();
  preferenceRequest.mockReturnValueOnce(pending.promise);
  recommendationRequest.mockResolvedValueOnce(json({ basis: "liked_tracks", hiddenCount: 0, results: [track] }))
    .mockResolvedValueOnce(json({ basis: "none", hiddenCount: 1, results: [] }));
  function RotatePreferenceToken() {
    const auth = useTfAuth();
    return <button onClick={() => {
      session = { ...session, csrfToken: "d".repeat(42) + "A" };
      void auth.refresh().then(rotated);
    }}>Rotate preference token</button>;
  }
  renderDiscover(<><RotatePreferenceToken /><Discover /></>);
  await user.click(await screen.findByRole("button", { name: "Не рекомендовать New Track" }));
  await user.click(screen.getByRole("button", { name: "Rotate preference token" }));
  await waitFor(() => expect(rotated).toHaveBeenCalledOnce());
  expect(recommendationRequest).toHaveBeenCalledOnce();
  await act(async () => { pending.resolve(json({ schemaVersion: 1, status: "hidden" })); });
  await screen.findByText("Скрыто записей: 1");
  expect(screen.queryByRole("heading", { name: "New Track" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Отменить скрытие" })).toBeNull();
  expect(screen.queryByText(/Запись скрыта:/)).toBeNull();
});

it("serializes a new exclusion behind an authoritative refresh without unmounting retained rows", async () => {
  const user = userEvent.setup();
  const other = { ...track, id: "sc_other", title: "Other Track" };
  const selection = { basis: "mixed", hiddenCount: 0, results: [track, other] };
  const pending = pendingResponse();
  recommendationRequest.mockResolvedValueOnce(json(selection)).mockReturnValueOnce(pending.promise);
  preferenceRequest.mockResolvedValueOnce(json({ schemaVersion: 1, status: "hidden" }))
    .mockResolvedValueOnce(json({ schemaVersion: 1, status: "restored" }));
  renderDiscover();
  const heading = await screen.findByRole("heading", { name: track.title });
  await user.click(screen.getByRole("button", { name: "Не рекомендовать Other Track" }));
  await user.click(await screen.findByRole("button", { name: "Отменить скрытие" }));
  await waitFor(() => expect(recommendationRequest).toHaveBeenCalledTimes(2));
  const hide = screen.getByRole("button", { name: "Не рекомендовать New Track" });
  expect(hide).toBeDisabled();
  expect(heading).toBeInTheDocument();
  await user.click(hide);
  expect(preferenceRequest).toHaveBeenCalledTimes(2);
  await act(async () => { pending.resolve(json(selection)); });
  await waitFor(() => expect(hide).toBeEnabled());
  await user.click(hide);
  await screen.findByText("Скрыто записей: 1");
  expect(screen.queryByRole("heading", { name: track.title })).toBeNull();
  expect(screen.getByRole("heading", { name: "Other Track" })).toBeInTheDocument();
});
