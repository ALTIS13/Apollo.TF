import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Player } from "./Player";

const player = vi.hoisted(() => ({
  currentTrack: { id: "yt_first", title: "First track", artist: "Artist", duration: 180 },
  isPlaying: true,
  isLoading: false,
  progress: 30,
  duration: 180,
  volume: 0.8,
  queue: [{ id: "yt_first" }, { id: "yt_second" }],
  queueIndex: 0,
  repeatMode: "off" as "off" | "all" | "one",
  shuffleEnabled: false,
  cycleRepeatMode: vi.fn(),
  toggleShuffle: vi.fn(),
  togglePlayPause: vi.fn(),
  seekTo: vi.fn(),
  setVolume: vi.fn(),
  playNext: vi.fn(),
  playPrev: vi.fn(),
}));

vi.mock("@/hooks/use-player", () => ({ usePlayer: () => player }));
vi.mock("./LyricsPanel", () => ({
  LyricsPanel: ({ onOpenChange }: { onOpenChange: (open: boolean) => void }) => (
    <div role="dialog" aria-label="Текст песни">
      <button type="button" onClick={() => onOpenChange(false)}>Закрыть текст</button>
    </div>
  ),
}));
const globalShortcut = vi.fn();
function handleGlobalKey(event: KeyboardEvent) {
  if (event.code === "Space") {
    event.preventDefault();
    globalShortcut();
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  player.isLoading = false;
  player.progress = 30;
  player.queue = [{ id: "yt_first" }, { id: "yt_second" }];
  player.queueIndex = 0;
  player.repeatMode = "off";
  player.shuffleEnabled = false;
  window.addEventListener("keydown", handleGlobalKey);
});
afterEach(() => {
  cleanup();
  window.removeEventListener("keydown", handleGlobalKey);
});

it.each([
  { name: "Предыдущий", action: "playPrev" },
  { name: "Пауза", action: "togglePlayPause" },
  { name: "Следующий", action: "playNext" },
  { name: "Выключить звук", action: "setVolume" },
] as const)("$name uses native Enter and Space without the global shortcut", async ({ name, action }) => {
  const user = userEvent.setup();
  render(<Player />);
  screen.getByRole("button", { name }).focus();
  await user.keyboard("{Enter}");
  expect(player[action]).toHaveBeenCalledTimes(1);
  await user.keyboard(" ");
  expect(player[action]).toHaveBeenCalledTimes(2);
  if (action === "setVolume") expect(player.setVolume.mock.calls).toEqual([[0], [0]]);
  for (const other of ["playPrev", "playNext", "togglePlayPause", "setVolume"] as const) {
    if (other !== action) expect(player[other]).not.toHaveBeenCalled();
  }
  expect(globalShortcut).not.toHaveBeenCalled();
});

it("keeps disabled transport controls inactive and out of the tab order", async () => {
  player.isLoading = true;
  player.progress = 0;
  player.queue = [{ id: "yt_first" }];
  const user = userEvent.setup();
  render(<Player />);
  for (const name of ["Предыдущий", "Пауза", "Следующий"]) {
    const button = screen.getByRole("button", { name });
    expect(button).toBeDisabled();
    await user.click(button);
  }
  await user.tab();
  expect(screen.getByRole("button", { name: "Перемешать" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Повтор: выключен" })).toHaveFocus();
  expect(player.playPrev).not.toHaveBeenCalled();
  expect(player.playNext).not.toHaveBeenCalled();
  expect(player.togglePlayPause).not.toHaveBeenCalled();
});

it("exposes shuffle and repeat modes with accessible state and native keyboard activation", async () => {
  const user = userEvent.setup();
  render(<Player />);
  const shuffle = screen.getByRole("button", { name: "Перемешать" });
  expect(shuffle).toHaveAttribute("aria-pressed", "false");
  shuffle.focus();
  await user.keyboard(" ");
  expect(player.toggleShuffle).toHaveBeenCalledTimes(1);
  expect(globalShortcut).not.toHaveBeenCalled();

  const repeat = screen.getByRole("button", { name: "Повтор: выключен" });
  await user.click(repeat);
  expect(player.cycleRepeatMode).toHaveBeenCalledTimes(1);
  cleanup();
  player.shuffleEnabled = true;
  player.repeatMode = "one";
  player.queueIndex = 1;
  render(<Player />);
  expect(screen.getByRole("button", { name: "Не перемешивать" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Повтор: один трек" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Следующий" })).toBeDisabled();
});

it("enables next at queue end only for repeat-all", () => {
  player.queueIndex = 1;
  player.repeatMode = "all";
  render(<Player />);
  expect(screen.getByRole("button", { name: "Следующий" })).toBeEnabled();
});

it("opens and closes the lyrics panel without changing playback", async () => {
  const user = userEvent.setup();
  render(<Player />);

  await user.click(screen.getByRole("button", { name: "Текст песни" }));
  expect(screen.getByRole("dialog", { name: "Текст песни" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Закрыть текст" }));
  expect(screen.queryByRole("dialog", { name: "Текст песни" })).toBeNull();
  expect(player.togglePlayPause).not.toHaveBeenCalled();
});
