import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import type { TrackResult } from "@workspace/api-client-react";
import {
  cancelDownloadJob,
  getDownloadJobStatus,
  queueTrackDownloads,
} from "@workspace/api-client-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackCard } from "./TrackCard";
import { TfSessionBoundary } from "@/auth/TfSessionBoundary";

const toast = vi.hoisted(() => vi.fn());
const playerActions = vi.hoisted(() => ({
  addNextToQueue: vi.fn(), addToQueue: vi.fn(), playTrack: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  status: "authenticated" as "authenticated" | "unavailable",
  session: { accountId: "account-a", installationId: "installation-a", entitlements: ["tf.search"] },
  error: null,
  hasEntitlement: () => true,
  refresh: vi.fn(async () => {}),
  login: vi.fn(),
  logout: vi.fn(async () => {}),
}));
vi.mock("@/auth/tf-auth", () => ({ useTfAuth: () => auth }));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    queueTrackDownloads: vi.fn(),
    getDownloadJobStatus: vi.fn(() => new Promise(() => {})),
    cancelDownloadJob: vi.fn(),
  };
});

vi.mock("@/hooks/use-player", () => ({
  usePlayer: () => ({
    currentTrack: null,
    isPlaying: false,
    isLoading: false,
    playTrack: playerActions.playTrack,
    togglePlayPause: vi.fn(),
    addToQueue: playerActions.addToQueue,
    addNextToQueue: playerActions.addNextToQueue,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/lib/tf-session-client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/tf-session-client")>();
  return {
    ...actual,
    reportTfAuthError: vi.fn(),
    tfRequestInit: vi.fn((init: RequestInit = {}) => ({
      ...init,
      credentials: "include",
    })),
  };
});

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

beforeEach(() => {
  auth.status = "authenticated";
  auth.refresh.mockClear();
  vi.mocked(queueTrackDownloads).mockReset();
  vi.mocked(getDownloadJobStatus)
    .mockReset()
    .mockImplementation(() => new Promise(() => {}));
  vi.mocked(cancelDownloadJob).mockReset().mockResolvedValue({
    jobId: "job-1",
    status: "canceled",
  });
  toast.mockReset();
  playerActions.addNextToQueue.mockReset();
  playerActions.addToQueue.mockReset();
  playerActions.playTrack.mockReset();
  vi.stubGlobal("location", { assign: vi.fn(), pathname: "/", search: "" });
});

it("offers named queue icons for native keyboard activation without starting playback or a download", async () => {
  const user = userEvent.setup();
  render(<TrackCard track={track} index={0} compact />);
  const next = screen.getByRole("button", { name: "Играть следующим: Test Track" });
  next.focus();
  await user.keyboard("{Enter}");
  expect(playerActions.addNextToQueue).toHaveBeenCalledExactlyOnceWith(track);

  const queue = screen.getByRole("button", { name: "Добавить в очередь: Test Track" });
  expect(queue.textContent).toBe("");
  queue.focus();
  await user.keyboard(" ");
  expect(playerActions.addToQueue).toHaveBeenCalledExactlyOnceWith(track);
  expect(queue).toHaveAccessibleName("Добавить в очередь: Test Track");
  expect(playerActions.playTrack).not.toHaveBeenCalled();
  expect(queueTrackDownloads).not.toHaveBeenCalled();
});

it.each([true, false])("keeps play keyboard reachable with collection actions when compact=%s", async (compact) => {
  const user = userEvent.setup();
  render(<TrackCard track={track} index={0} compact={compact}
    collectionAction={<button type="button" aria-label="Save this recording">Save</button>}
  />);
  await user.tab();
  expect(screen.getByRole("button", { name: "Воспроизвести: Test Track" })).toHaveFocus();
  await user.keyboard("{Enter}");
  await user.keyboard(" ");
  expect(playerActions.playTrack.mock.calls).toEqual([[track], [track]]);
  expect(screen.getByRole("button", { name: "Save this recording" })).toBeInTheDocument();
  expect(playerActions.addNextToQueue).not.toHaveBeenCalled();
  expect(playerActions.addToQueue).not.toHaveBeenCalled();
  expect(queueTrackDownloads).not.toHaveBeenCalled();
});

it("shows candidate metadata without presenting it as verified file quality", () => {
  const { rerender } = render(
    <TrackCard
      track={{ ...track, score: 742, quality: ["128", "320"] }}
      index={0}
      compact
    />,
  );

  expect(screen.getByText("3:00")).toBeInTheDocument();
  expect(screen.getByText("Оригинал")).toBeInTheDocument();
  expect(screen.getByText("youtube")).toBeInTheDocument();
  expect(screen.getByText("Рейтинг поиска: 742")).toBeInTheDocument();
  expect(screen.getByText("Метки битрейта: 128, 320 кбит/с · файл не проверен")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Скачать" })).toBeInTheDocument();

  rerender(<TrackCard track={{ ...track, duration: 0, quality: [] }} index={0} />);
  expect(screen.getByText("Длительность неизвестна")).toBeInTheDocument();
  expect(screen.getByText("Битрейт не указан")).toBeInTheDocument();
  expect(screen.queryByText("0:00")).not.toBeInTheDocument();

  rerender(<TrackCard track={{ ...track, type: "live", quality: ["lossless"] }} index={0} />);
  expect(screen.getByText("Лайв")).toBeInTheDocument();
  expect(screen.getByText("Метки источника: lossless · файл не проверен")).toBeInTheDocument();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function expectReservedTerminalRow(label: string, visibleLabel = label) {
  const action = screen.getByTestId("track-download-action");
  const status = within(action).getByRole("status");
  const control = within(action).getByRole("button", { name: "Скачать" });

  expect(action).toHaveClass("h-[64px]", "w-[72px]");
  expect(control).toHaveClass("h-[44px]");
  expect(status).toHaveClass("h-[20px]");
  expect(status).toHaveAccessibleName(label);
  expect(status).toHaveTextContent(visibleLabel);
  expect(status.previousElementSibling).toBe(control);
  expect(action.querySelector('[class~="absolute"]')).toBeNull();
}

describe("TrackCard download action", () => {
  it("queues one track from its download action without resizing the action area", async () => {
    vi.mocked(queueTrackDownloads).mockResolvedValue({
      results: [{ trackId: track.id, jobId: "job-1", position: 1 }],
    });
    vi.mocked(getDownloadJobStatus).mockResolvedValue({ status: "active", progress: 42 });
    render(<TrackCard track={track} index={0} />);

    const action = screen.getByTestId("track-download-action");
    expect(action).toHaveClass("h-[64px]", "w-[72px]");
    expect(within(action).getByRole("button", { name: "Скачать" })).toHaveClass("h-[44px]");
    fireEvent.click(screen.getByRole("button", { name: "Скачать" }));

    await waitFor(() => expect(queueTrackDownloads).toHaveBeenCalledTimes(1));
    const status = await screen.findByRole("status", { name: "Загрузка 42%" });
    expect(status).toHaveTextContent("42%");
    expect(action).toHaveClass("h-[64px]", "w-[72px]");
    expect(within(action).getByRole("button", { name: "Отменить загрузку" })).toHaveClass("h-[44px]", "w-[44px]");
    expect(screen.getByTitle("Отменить загрузку")).toHaveAttribute(
      "aria-label",
      "Отменить загрузку",
    );
    expect(screen.getByTitle("Загрузка")).toHaveAttribute(
      "aria-label",
      "Загрузка",
    );
  });

  it("renders bounded failure feedback and keeps a retryable download control", async () => {
    vi.mocked(queueTrackDownloads).mockRejectedValue(
      new Error("secret provider response"),
    );
    render(<TrackCard track={track} index={0} />);

    fireEvent.click(screen.getByRole("button", { name: "Скачать" }));

    await screen.findByRole("status", { name: "Не удалось начать загрузку." });
    expectReservedTerminalRow("Не удалось начать загрузку.", "Ошибка");
    expect(screen.getByRole("button", { name: "Скачать" })).not.toBeDisabled();
  });

  it("explains a rejected preview without showing internal worker details", async () => {
    vi.mocked(queueTrackDownloads).mockResolvedValue({
      results: [{ trackId: track.id, jobId: "job-1", position: 1 }],
    });
    vi.mocked(getDownloadJobStatus).mockResolvedValue({
      status: "failed",
      progress: 0,
      failureCode: "preview_rejected",
    });
    render(<TrackCard track={track} index={0} />);

    fireEvent.click(screen.getByRole("button", { name: "Скачать" }));

    await screen.findByRole("status", { name: "Только фрагмент трека." });
    expectReservedTerminalRow("Только фрагмент трека.", "Фрагмент");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      description: "Источник содержит только фрагмент трека. Выберите другую запись.",
    }));
  });

  it("renders canceled feedback in the reserved non-overlapping row", async () => {
    vi.mocked(queueTrackDownloads).mockImplementation(
      () => new Promise(() => {}),
    );
    render(<TrackCard track={track} index={0} />);

    fireEvent.click(screen.getByRole("button", { name: "Скачать" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Отменить загрузку" }),
    );

    await screen.findByText("Загрузка отменена");
    expectReservedTerminalRow("Загрузка отменена");
  });

  it("keeps the cancel control available when known-job DELETE fails", async () => {
    vi.mocked(queueTrackDownloads).mockResolvedValue({
      results: [{ trackId: track.id, jobId: "job-1", position: 1 }],
    });
    vi.mocked(cancelDownloadJob).mockRejectedValue({
      status: 503,
      data: { error: "download_queue_unavailable" },
    });
    render(<TrackCard track={track} index={0} />);

    fireEvent.click(screen.getByRole("button", { name: "Скачать" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Отменить загрузку" }),
    );

    await waitFor(() => expect(cancelDownloadJob).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("button", { name: "Отменить загрузку" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Загрузка отменена")).not.toBeInTheDocument();
    expect(screen.getByTestId("track-download-action")).toHaveClass("h-[64px]", "w-[72px]");
  });

  it("renders completed feedback in the reserved non-overlapping row", async () => {
    vi.mocked(queueTrackDownloads).mockResolvedValue({
      results: [{ trackId: track.id, jobId: "job-1", position: 1 }],
    });
    vi.mocked(getDownloadJobStatus).mockResolvedValue({
      status: "completed",
      progress: 100,
    });
    render(<TrackCard track={track} index={0} />);

    fireEvent.click(screen.getByRole("button", { name: "Скачать" }));

    await screen.findByText("Загрузка завершена");
    expectReservedTerminalRow("Загрузка завершена");
    expect(screen.getByRole("button", { name: "Скачать" })).toBeDisabled();
  });

  it("renders neutral completed feedback when DELETE reports completion without navigation", async () => {
    vi.mocked(queueTrackDownloads).mockResolvedValue({
      results: [{ trackId: track.id, jobId: "job-1", position: 1 }],
    });
    vi.mocked(cancelDownloadJob).mockResolvedValue({
      jobId: "job-1",
      status: "completed",
    });
    render(<TrackCard track={track} index={0} />);

    fireEvent.click(screen.getByRole("button", { name: "Скачать" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Отменить загрузку" }),
    );

    await screen.findByText("Загрузка завершена");
    expectReservedTerminalRow("Загрузка завершена");
    expect(window.location.assign).not.toHaveBeenCalled();
    await waitFor(() => expect(toast).toHaveBeenCalledWith({
      title: "Загрузка завершена",
      description: track.title,
    }));
  });
});

describe("touch recording details", () => {
  it("closes the body portal when the retained session becomes unavailable without reopening on recovery", async () => {
    const view = () => <TfSessionBoundary><TrackCard track={track} index={0} compact /></TfSessionBoundary>;
    const { rerender } = render(view());
    fireEvent.click(screen.getByRole("button", { name: "Сведения об источнике: Test Track" }));
    expect(screen.getByRole("dialog", { name: "Сведения об источнике" })).toBeVisible();

    auth.status = "unavailable";
    rerender(view());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Test Track")).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "Сервис временно недоступен" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(auth.refresh).toHaveBeenCalledOnce();

    auth.status = "authenticated";
    rerender(view());
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Сведения об источнике: Test Track" }));
    expect(screen.getByRole("dialog", { name: "Сведения об источнике" })).toBeVisible();
    expect(playerActions.playTrack).not.toHaveBeenCalled();
    expect(queueTrackDownloads).not.toHaveBeenCalled();
  });

  it("opens full source and unverified quality details by keyboard, then restores focus without starting playback", async () => {
    const user = userEvent.setup();
    render(<TrackCard track={{ ...track, quality: ["128", "320"] }} index={0} compact />);
    const info = screen.getByRole("button", { name: "Сведения об источнике: Test Track" });
    info.focus();
    await user.keyboard("{Enter}");
    const dialog = screen.getByRole("dialog", { name: "Сведения об источнике" });
    expect(within(dialog).getByText("Test Artist")).toBeInTheDocument();
    expect(within(dialog).getByText("Test Track")).toBeInTheDocument();
    expect(within(dialog).getByText("Оригинал")).toBeInTheDocument();
    expect(within(dialog).getByText("128, 320 кбит/с")).toBeInTheDocument();
    expect(within(dialog).getByText("Качество исходного файла не подтверждено.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Повторить загрузку" })).toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(info).toHaveFocus());
    expect(queueTrackDownloads).not.toHaveBeenCalled();
    expect(playerActions.playTrack).not.toHaveBeenCalled();
  });

  it.each(["preview_rejected", "duration_unverified"] as const)(
    "exposes the complete %s failure by tap without enlarging download controls",
    async (failureCode) => {
      vi.mocked(queueTrackDownloads).mockResolvedValue({ results: [{ trackId: track.id, jobId: "job-1", position: 1 }] });
      vi.mocked(getDownloadJobStatus).mockResolvedValue({ status: "failed", progress: 0, failureCode });
      render(<TrackCard track={track} index={0} compact />);
      fireEvent.click(screen.getByRole("button", { name: "Скачать" }));
      await screen.findByRole("status", { name: failureCode === "preview_rejected" ? "Только фрагмент трека." : "Длительность не проверена." });
      fireEvent.click(screen.getByRole("button", { name: "Сведения об источнике: Test Track" }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(failureCode)).toBeInTheDocument();
      expect(within(dialog).getByText(failureCode === "preview_rejected"
        ? "Источник содержит только фрагмент трека. Выберите другую запись."
        : "Не удалось проверить длительность записи. Попробуйте другой источник.")).toBeInTheDocument();
      expect(screen.getByTestId("track-download-action")).toHaveClass("h-[64px]", "w-[72px]");
      expect(within(dialog).getByRole("button", { name: "Повторить загрузку" })).toBeEnabled();
    },
  );

  it("retries the same recording from details and never exposes an unknown private failure code", async () => {
    vi.mocked(queueTrackDownloads)
      .mockResolvedValueOnce({ results: [{ trackId: track.id, jobId: "job-1", position: 1 }] })
      .mockImplementationOnce(() => new Promise(() => {}));
    vi.mocked(getDownloadJobStatus).mockResolvedValue({
      status: "failed", progress: 0, failureCode: "private-provider-token" as never,
    });
    render(<TrackCard track={track} index={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Скачать" }));
    await screen.findByRole("status", { name: "Не удалось начать загрузку." });
    fireEvent.click(screen.getByRole("button", { name: "Сведения об источнике: Test Track" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Не удалось начать загрузку.")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("private-provider-token");
    fireEvent.click(within(dialog).getByRole("button", { name: "Повторить загрузку" }));
    await waitFor(() => expect(queueTrackDownloads).toHaveBeenCalledTimes(2));
    expect(vi.mocked(queueTrackDownloads).mock.calls[1]![0]).toEqual(vi.mocked(queueTrackDownloads).mock.calls[0]![0]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(playerActions.playTrack).not.toHaveBeenCalled();
  });

  it("offers an encoded source-recovery link with the exact versioned title and router base without downloading", () => {
    const recording = { ...track, artist: "Artist & Co+", title: "Signal / Noise (Live & Uncut)" };
    render(<Router base="/tf"><TrackCard track={recording} index={0} /></Router>);
    fireEvent.click(screen.getByRole("button", { name: `Сведения об источнике: ${recording.title}` }));
    const link = within(screen.getByRole("dialog")).getByRole("link", { name: "Другой источник" });
    const href = link.getAttribute("href")!;
    expect(href).toBe("/tf/?artist=Artist+%26+Co%2B&title=Signal+%2F+Noise+%28Live+%26+Uncut%29");
    expect(queueTrackDownloads).not.toHaveBeenCalled();
    expect(playerActions.addToQueue).not.toHaveBeenCalled();
  });

  it("does not invent a source-recovery query for missing recording identity", () => {
    render(<TrackCard track={{ ...track, artist: "" }} index={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Сведения об источнике: Test Track" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("link", { name: "Другой источник" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Другой источник" })).toBeDisabled();
    expect(within(dialog).getByText("Недостаточно данных для поиска другой записи.")).toBeInTheDocument();
    expect(queueTrackDownloads).not.toHaveBeenCalled();
  });
});
