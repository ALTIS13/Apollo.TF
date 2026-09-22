import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Queue from "./Queue";

const player = vi.hoisted(() => ({
  queue: [
    { id: "yt_first", title: "First track", artist: "Artist", duration: 180, thumbnailUrl: null },
    { id: "sc_second", title: "Second track", artist: "Artist", duration: 210, thumbnailUrl: null },
  ],
  queueIndex: -1,
  currentTrack: null,
  playFromQueue: vi.fn(),
  removeFromQueue: vi.fn(),
  clearQueue: vi.fn(),
}));

vi.mock("@/hooks/use-player", () => ({ usePlayer: () => player }));
const globalPlaybackShortcut = vi.fn();
function handleGlobalKey(event: KeyboardEvent) {
  if (event.code === "Space") {
    event.preventDefault();
    globalPlaybackShortcut();
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  window.addEventListener("keydown", handleGlobalKey);
});
afterEach(() => {
  cleanup();
  window.removeEventListener("keydown", handleGlobalKey);
});

it("plays the focused queue item with Enter and Space in queue order", async () => {
  const user = userEvent.setup();
  render(<Queue />);
  screen.getByRole("button", { name: "Очистить" }).focus();

  await user.tab();
  expect(screen.getByRole("button", { name: "Воспроизвести First track" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(player.playFromQueue).toHaveBeenNthCalledWith(1, 0);

  await user.tab();
  await user.tab();
  expect(screen.getByRole("button", { name: "Воспроизвести Second track" })).toHaveFocus();
  await user.keyboard(" ");
  expect(player.playFromQueue).toHaveBeenNthCalledWith(2, 1);
  expect(player.playFromQueue).toHaveBeenCalledTimes(2);
  expect(player.removeFromQueue).not.toHaveBeenCalled();
  expect(globalPlaybackShortcut).not.toHaveBeenCalled();
});

it("removes the focused item without triggering playback or nesting buttons", async () => {
  const user = userEvent.setup();
  const { container } = render(<Queue />);
  screen.getByRole("button", { name: "Очистить" }).focus();

  await user.tab();
  await user.tab();
  expect(screen.getByRole("button", { name: "Удалить First track из очереди" })).toHaveFocus();
  await user.keyboard(" ");
  expect(player.removeFromQueue).toHaveBeenNthCalledWith(1, 0);

  await user.tab();
  await user.tab();
  expect(screen.getByRole("button", { name: "Удалить Second track из очереди" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(player.removeFromQueue).toHaveBeenNthCalledWith(2, 1);
  expect(player.removeFromQueue).toHaveBeenCalledTimes(2);
  expect(player.playFromQueue).not.toHaveBeenCalled();
  expect(container.querySelector("button button")).toBeNull();
  expect(globalPlaybackShortcut).not.toHaveBeenCalled();
});
