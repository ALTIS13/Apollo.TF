import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackCard } from "@/components/TrackCard";
import { PlayerProvider, usePlayer } from "@/hooks/use-player";
import {
  TfApiError,
  canUseTfProtectedActivity,
  clearTfSessionSecurityState,
} from "@/lib/tf-session-client";
import { TfSessionBoundary } from "./TfSessionBoundary";
import { TfAuthProvider } from "./tf-auth";
import type { TrackResult } from "@workspace/api-client-react";
import { writeQueueSnapshot } from "@/lib/queue-persistence";

const runtime = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  logoutSession: vi.fn(),
  tfFetch: vi.fn(),
  streamQuery: vi.fn(),
  queueDownload: vi.fn(),
  toast: vi.fn(),
  lifecycleOptions: [] as Array<{
    onTerminalError: (error: unknown) => void;
  }>,
  lifecycleStarts: 0,
  lifecycleStops: 0,
}));

vi.mock("@/lib/tf-session-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/tf-session-client")>();
  return {
    ...actual,
    fetchTfSession: runtime.fetchSession,
    logoutTfSession: runtime.logoutSession,
    startTfLogin: vi.fn(),
    tfFetch: runtime.tfFetch,
  };
});

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    getGetTrackStreamQueryOptions: (trackId: string) => ({
      queryKey: ["test-stream", trackId],
      queryFn: runtime.streamQuery,
    }),
    queueTrackDownloads: runtime.queueDownload,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: runtime.toast }),
}));

vi.mock("@/lib/tf-websocket", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tf-websocket")>()),
  TfWebSocketLifecycle: class {
    private running = false;
    constructor(options: { onTerminalError: (error: unknown) => void }) {
      runtime.lifecycleOptions.push(options);
    }

    start() {
      if (this.running) return;
      this.running = true;
      runtime.lifecycleStarts += 1;
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      runtime.lifecycleStops += 1;
    }
  },
}));

const session = {
  accountId: "10000000-0000-4000-8000-000000000001",
  installationId: "20000000-0000-4000-8000-000000000002",
  entitlements: ["tf.search", "tf.downloads"],
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  csrfToken: "c".repeat(42) + "A",
};

const track: TrackResult = {
  id: "track-1",
  title: "Test Track",
  artist: "Test Artist",
  thumbnailUrl: null,
  duration: 180,
  source: "youtube",
  type: "original",
  quality: [],
  score: 1,
};

class FakeAudio {
  static instances: FakeAudio[] = [];
  currentTime = 0;
  duration = 0;
  volume = 0.8;
  src = "";
  readonly addEventListener = vi.fn();
  readonly removeEventListener = vi.fn();
  readonly pause = vi.fn();
  readonly play = vi.fn().mockResolvedValue(undefined);
  readonly load = vi.fn();

  constructor() {
    FakeAudio.instances.push(this);
  }
}

function PlayerActions({
  includeDownload = false,
}: {
  includeDownload?: boolean;
}) {
  const { playTrack, currentTrack, isPlaying, isLoading } = usePlayer();

  return (
    <div data-testid="protected-runtime">
      <output
        data-testid="player-state"
        data-track-id={currentTrack?.id ?? ""}
        data-playing={isPlaying}
        data-loading={isLoading}
      />
      <button onClick={() => void playTrack(track)}>
        Play generated stream
      </button>
      {includeDownload ? <TrackCard track={track} index={0} /> : null}
    </div>
  );
}

function PlaylistPlaybackActions() {
  const { playCollection, togglePlayPause, queue, currentTrack, isPlaying } = usePlayer();
  const second = { ...track, id: "track-2", title: "Second Track" };
  return <div>
    <output data-testid="playlist-queue" data-ids={queue.map((item) => item.id).join(",")} data-current={currentTrack?.id ?? ""} data-playing={isPlaying} />
    <button type="button" onClick={() => void playCollection([track, second])}>Play playlist</button>
    <button type="button" onClick={togglePlayPause}>Resume queue</button>
  </div>;
}

function renderProtectedRuntime(children: ReactNode = <PlayerActions />) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TfAuthProvider>
        <TfSessionBoundary>
          <PlayerProvider>{children}</PlayerProvider>
        </TfSessionBoundary>
      </TfAuthProvider>
    </QueryClientProvider>,
  );

  return { ...view, queryClient };
}

function generatedError(status: number, code: string) {
  return { status, data: { error: code } };
}

beforeEach(() => {
  clearTfSessionSecurityState();
  runtime.fetchSession.mockReset();
  runtime.logoutSession.mockReset().mockResolvedValue(undefined);
  runtime.tfFetch.mockReset().mockResolvedValue(undefined);
  runtime.streamQuery.mockReset();
  runtime.queueDownload.mockReset();
  runtime.toast.mockReset();
  runtime.lifecycleOptions.length = 0;
  runtime.lifecycleStarts = 0;
  runtime.lifecycleStops = 0;
  FakeAudio.instances = [];
  window.localStorage.clear();
  vi.stubGlobal("Audio", FakeAudio);
});

afterEach(() => {
  cleanup();
  clearTfSessionSecurityState();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("protected generated API auth failures", () => {
  it.each([
    [422, "preview_rejected", "Источник содержит только фрагмент трека. Выберите другую запись."],
    [503, "duration_unverified", "Не удалось проверить длительность записи. Попробуйте другой источник."],
  ])("keeps the session active after media admission %s %s", async (status, code, description) => {
    runtime.fetchSession.mockResolvedValueOnce(session);
    runtime.streamQuery.mockRejectedValueOnce(generatedError(status, code));
    renderProtectedRuntime();

    fireEvent.click(await screen.findByRole("button", { name: "Play generated stream" }));

    await waitFor(() => expect(runtime.toast).toHaveBeenCalledWith({
      title: "Ошибка воспроизведения",
      description,
      variant: "destructive",
    }));
    expect(canUseTfProtectedActivity()).toBe(true);
    expect(screen.getByTestId("protected-runtime")).toBeInTheDocument();
  });

  it("keeps the authenticated player stopped after stream_error 500", async () => {
    runtime.fetchSession.mockResolvedValueOnce(session);
    runtime.streamQuery.mockRejectedValueOnce({
      status: 500,
      data: {
        error: "stream_error",
        message: "Could not resolve stream URL",
      },
    });
    renderProtectedRuntime();

    const play = await screen.findByRole("button", {
      name: "Play generated stream",
    });
    expect(canUseTfProtectedActivity()).toBe(true);
    expect(FakeAudio.instances).toHaveLength(1);
    await act(async () => { fireEvent.click(play); });

    await waitFor(() => expect(runtime.streamQuery).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(runtime.toast).toHaveBeenCalledWith({
        title: "Ошибка воспроизведения",
        description: "Не удалось загрузить трек.",
        variant: "destructive",
      }),
    );
    expect(FakeAudio.instances[0].src).toBe("");
    expect(FakeAudio.instances[0].play).not.toHaveBeenCalled();
    expect(screen.getByTestId("player-state")).toHaveAttribute(
      "data-track-id",
      "",
    );
    expect(screen.getByTestId("player-state")).toHaveAttribute(
      "data-playing",
      "false",
    );
    expect(screen.getByTestId("player-state")).toHaveAttribute(
      "data-loading",
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Play generated stream" }),
    ).toBeEnabled();
    expect(canUseTfProtectedActivity()).toBe(true);
    expect(runtime.fetchSession).toHaveBeenCalledTimes(1);
    expect(runtime.logoutSession).not.toHaveBeenCalled();
    expect(runtime.streamQuery).toHaveBeenCalledTimes(1);
  });

  it("invalidates and unmounts after generated stream unauthorized while preserving playback feedback", async () => {
    runtime.fetchSession.mockResolvedValueOnce(session);
    runtime.streamQuery.mockRejectedValueOnce(
      generatedError(401, "unauthorized"),
    );
    renderProtectedRuntime();

    fireEvent.click(
      await screen.findByRole("button", { name: "Play generated stream" }),
    );

    await waitFor(() => expect(runtime.streamQuery).toHaveBeenCalledTimes(1), {
      timeout: 3_000,
    });
    expect(
      await screen.findByRole(
        "heading",
        { name: "Требуется вход" },
        { timeout: 3_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("protected-runtime")).not.toBeInTheDocument();
    expect(runtime.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Ошибка воспроизведения",
        variant: "destructive",
      }),
    );
  });

  it.each([
    [
      generatedError(403, "module_access_denied"),
      { ...session, entitlements: ["tf.downloads"] },
      "Модуль недоступен",
    ],
    [
      generatedError(503, "policy_unavailable"),
      new TfApiError(503, "policy_unavailable", "unavailable"),
      "Сервис временно недоступен",
    ],
  ])(
    "blocks generated stream policy failures and rechecks policy before recovery",
    async (error, refreshResult, heading) => {
      runtime.fetchSession.mockResolvedValueOnce(session);
      if (refreshResult instanceof Error) {
        runtime.fetchSession.mockRejectedValueOnce(refreshResult);
      } else {
        runtime.fetchSession.mockResolvedValueOnce(refreshResult);
      }
      runtime.streamQuery.mockRejectedValueOnce(error);
      renderProtectedRuntime();

      fireEvent.click(
        await screen.findByRole("button", { name: "Play generated stream" }),
      );

      if (refreshResult instanceof Error) {
        fireEvent.click(await screen.findByRole("button", { name: "Повторить" }));
      }
      expect(
        await screen.findByRole("heading", { name: heading }),
      ).toBeInTheDocument();
      expect(runtime.fetchSession).toHaveBeenCalledTimes(2);
      // A valid session can retain downloads while the search/player gate is closed.
      expect(canUseTfProtectedActivity()).toBe(!(refreshResult instanceof Error));
      expect(screen.queryByRole("button", { name: "Play generated stream" })).not.toBeInTheDocument();
      expect(FakeAudio.instances[0].src).toBe("");
      expect(FakeAudio.instances[0].load).toHaveBeenCalled();
      expect(runtime.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Ошибка воспроизведения",
          variant: "destructive",
        }),
      );
    },
  );

  it.each([
    [generatedError(401, "unauthorized"), null, "Требуется вход"],
    [
      generatedError(403, "module_access_denied"),
      { ...session, entitlements: ["tf.downloads"] },
      "Модуль недоступен",
    ],
  ])(
    "forwards generated queue auth failures",
    async (error, refreshSession, heading) => {
      runtime.fetchSession.mockResolvedValueOnce(session);
      if (refreshSession !== null) {
        runtime.fetchSession.mockResolvedValueOnce(refreshSession);
      }
      runtime.queueDownload.mockRejectedValueOnce(error);
      renderProtectedRuntime(<PlayerActions includeDownload />);

      fireEvent.click(await screen.findByRole("button", { name: "Скачать" }));

      expect(
        await screen.findByRole("heading", { name: heading }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("protected-runtime")).not.toBeInTheDocument();
    },
  );
});

describe("pre-open WebSocket auth integration", () => {
  it("suspends websocket_unavailable until deliberate retry starts one fresh lifecycle", async () => {
    runtime.fetchSession
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(session);
    renderProtectedRuntime();

    expect(await screen.findByTestId("protected-runtime")).toBeInTheDocument();
    expect(runtime.lifecycleStarts).toBe(1);

    act(() => {
      runtime.lifecycleOptions[0].onTerminalError(
        new TfApiError(503, "websocket_unavailable", "unavailable"),
      );
    });

    expect(screen.getByTestId("protected-runtime")).not.toBeVisible();
    expect(canUseTfProtectedActivity()).toBe(false);
    expect(FakeAudio.instances[0].load).toHaveBeenCalled();
    expect(runtime.fetchSession).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(runtime.fetchSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId("protected-runtime")).toBeVisible());
    expect(runtime.lifecycleStarts).toBe(2);
    expect(runtime.lifecycleStops).toBe(1);
  });

  it.each([
    [{ ...session, entitlements: ["tf.downloads"] }, "Модуль недоступен"],
    [
      new TfApiError(503, "policy_unavailable", "unavailable"),
      "Сервис временно недоступен",
    ],
  ])(
    "keeps the player inaccessible when websocket_unavailable retry remains denied",
    async (refreshResult, heading) => {
      runtime.fetchSession.mockResolvedValueOnce(session);
      if (refreshResult instanceof Error) {
        runtime.fetchSession.mockRejectedValueOnce(refreshResult);
      } else {
        runtime.fetchSession.mockResolvedValueOnce(refreshResult);
      }
      renderProtectedRuntime();

      expect(
        await screen.findByTestId("protected-runtime"),
      ).toBeInTheDocument();
      act(() => {
        runtime.lifecycleOptions[0].onTerminalError(
          new TfApiError(503, "websocket_unavailable", "unavailable"),
        );
      });

      expect(screen.getByTestId("protected-runtime")).not.toBeVisible();
      expect(canUseTfProtectedActivity()).toBe(false);
      expect(runtime.fetchSession).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Повторить" }));

      expect(
        await screen.findByRole("heading", { name: heading }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Play generated stream" })).not.toBeInTheDocument();
      expect(canUseTfProtectedActivity()).toBe(!(refreshResult instanceof Error));
      expect(runtime.fetchSession).toHaveBeenCalledTimes(2);
      expect(FakeAudio.instances[0].src).toBe("");
      expect(FakeAudio.instances[0].load).toHaveBeenCalled();
      expect(runtime.lifecycleStarts).toBe(1);
      expect(runtime.lifecycleStops).toBe(1);
    },
  );
});

it("replaces the queue with the full playlist and restarts its first track on repeated play", async () => {
  runtime.fetchSession.mockResolvedValueOnce(session);
  runtime.streamQuery.mockResolvedValue({ streamUrl: "https://example.test/audio" });
  renderProtectedRuntime(<PlaylistPlaybackActions />);
  const button = await screen.findByRole("button", { name: "Play playlist" });
  await act(async () => { fireEvent.click(button); });
  await waitFor(() => expect(screen.getByTestId("playlist-queue")).toHaveAttribute("data-playing", "true"));
  expect(screen.getByTestId("playlist-queue")).toHaveAttribute("data-ids", "track-1,track-2");
  await act(async () => { fireEvent.click(button); });
  await waitFor(() => expect(FakeAudio.instances[0].play).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId("playlist-queue")).toHaveAttribute("data-playing", "true");
  expect(screen.getByTestId("playlist-queue")).toHaveAttribute("data-current", "track-1");
});

it("restores an account queue paused and resolves a fresh stream only on resume", async () => {
  const restoredTrack = { ...track, id: "yt_restored", title: "Restored" };
  expect(writeQueueSnapshot(window.localStorage, session, [restoredTrack], 0, 42)).toBe(true);
  runtime.fetchSession.mockResolvedValueOnce(session);
  runtime.streamQuery.mockResolvedValue({ streamUrl: "https://example.test/fresh-audio" });
  renderProtectedRuntime(<PlaylistPlaybackActions />);

  await waitFor(() => expect(screen.getByTestId("playlist-queue"))
    .toHaveAttribute("data-ids", "yt_restored"));
  expect(screen.getByTestId("playlist-queue")).toHaveAttribute("data-current", "yt_restored");
  expect(screen.getByTestId("playlist-queue")).toHaveAttribute("data-playing", "false");
  expect(runtime.streamQuery).not.toHaveBeenCalled();
  expect(runtime.tfFetch).not.toHaveBeenCalled();

  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Resume queue" })); });
  await waitFor(() => expect(runtime.streamQuery).toHaveBeenCalledTimes(1));
  expect(FakeAudio.instances[0].currentTime).toBe(42);
  expect(FakeAudio.instances[0].src).toBe("https://example.test/fresh-audio");
  expect(runtime.tfFetch).toHaveBeenCalledWith("/tracks/play", expect.anything());
});
