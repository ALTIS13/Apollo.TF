import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TrackResult } from "@workspace/api-client-react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { Sidebar } from "./Sidebar";

const { player, logout } = vi.hoisted(() => ({
  player: {
    queue: [] as TrackResult[],
    queueIndex: -1,
    currentTrack: null as TrackResult | null,
    playFromQueue: vi.fn(),
    removeFromQueue: vi.fn(),
  },
  logout: vi.fn(),
}));

vi.mock("@/hooks/use-player", () => ({ usePlayer: () => player }));
vi.mock("@/auth/tf-auth", () => ({
  useTfAuth: () => ({
    session: { accountId: "10000000-0000-4000-8000-000000000001" },
    logout,
  }),
}));

const queueLabel = "\u041e\u0447\u0435\u0440\u0435\u0434\u044c";
const logoutLabel = "\u0412\u044b\u0439\u0442\u0438";
const track: TrackResult = {
  id: "yt_sidebar_track",
  title: "Queued track",
  artist: "Queued artist",
  thumbnailUrl: null,
  duration: 180,
  source: "youtube",
  type: "original",
  quality: [],
  score: 1,
};

beforeEach(() => {
  player.queue = [];
  player.queueIndex = -1;
  player.currentTrack = null;
});

afterEach(cleanup);

it.each([false, true])(
  "keeps only queue navigation and account actions when populated=%s",
  async (populated) => {
    if (populated) {
      player.queue = [track];
      player.queueIndex = 0;
      player.currentTrack = track;
    }
    const user = userEvent.setup();
    const { hook } = memoryLocation({ path: "/" });
    render(<Router hook={hook}><Sidebar /></Router>);

    expect(screen.queryByText(track.title)).not.toBeInTheDocument();
    expect(screen.queryByText(`${queueLabel} \u043f\u0443\u0441\u0442\u0430`)).not.toBeInTheDocument();
    expect(screen.getAllByText(queueLabel)).toHaveLength(1);
    expect(screen.getAllByRole("link", { name: queueLabel })).toHaveLength(1);
    expect(screen.getByRole("link", { name: queueLabel })).toHaveAttribute("href", "/queue");
    expect(screen.getByRole("link", { name: "Коллекция" })).toHaveAttribute("href", "/favorites");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("10000000...")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: logoutLabel }));
    expect(logout).toHaveBeenCalledTimes(1);
  },
);

it("opens the queue route and closes the mobile drawer without changing playback", async () => {
  player.queue = [track];
  player.queueIndex = 0;
  player.currentTrack = track;
  const user = userEvent.setup();
  const { hook } = memoryLocation({ path: "/" });

  function MobileDrawer() {
    const [open, setOpen] = useState(true);
    return open ? <Sidebar onClose={() => setOpen(false)} /> : null;
  }

  render(
    <Router hook={hook}>
      <MobileDrawer />
      <Route path="/queue"><h1>Queue destination</h1></Route>
    </Router>,
  );

  await user.click(screen.getByRole("link", { name: queueLabel }));

  expect(screen.getByRole("heading", { name: "Queue destination" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(player.playFromQueue).not.toHaveBeenCalled();
  expect(player.removeFromQueue).not.toHaveBeenCalled();
});
