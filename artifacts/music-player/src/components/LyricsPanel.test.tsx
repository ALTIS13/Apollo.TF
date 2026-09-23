import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TrackResult } from "@workspace/api-client-react";
import { LyricsPanel } from "./LyricsPanel";

const tfFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tf-session-client", () => ({ tfFetch }));
vi.mock("@/auth/tf-auth", () => ({
  useTfAuth: () => ({
    status: "authenticated",
    session: { accountId: "account-1" },
    hasEntitlement: (capability: string) => capability === "tf.search",
  }),
}));

const track: TrackResult = {
  id: "yt_first",
  title: "First song",
  artist: "Artist",
  duration: 180,
  thumbnailUrl: null,
  source: "youtube",
  type: "original",
  quality: [],
  score: 1,
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof LyricsPanel>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const seekTo = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <LyricsPanel
        track={track}
        progress={14}
        duration={180}
        seekTo={seekTo}
        open
        onOpenChange={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { seekTo };
}

beforeEach(() => tfFetch.mockReset());
afterEach(() => cleanup());

it("loads synced lyrics for the current track and seeks from a timestamped line", async () => {
  tfFetch.mockResolvedValue({
    plainLyrics: "First line\nSecond line",
    syncedLyrics: "[00:03.00]First line\n[00:12.50]Second line",
  });
  const { seekTo } = renderPanel();
  const user = userEvent.setup();

  const line = await screen.findByRole("button", { name: "Перейти к 0:12: Second line" });
  expect(line).toHaveAttribute("aria-current", "true");
  await user.click(line);
  expect(seekTo).toHaveBeenCalledWith((12.5 / 180) * 100);
  expect(tfFetch).toHaveBeenCalledWith(
    "/tracks/lyrics?artist=Artist&title=First+song&duration=180",
  );
});

it("does not retain the previous track's lyrics while a new track loads", async () => {
  let resolveSecond!: (value: unknown) => void;
  tfFetch
    .mockResolvedValueOnce({ plainLyrics: "Old lyrics", syncedLyrics: null })
    .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <LyricsPanel track={track} progress={0} duration={180} seekTo={vi.fn()} open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByText("Old lyrics");
  view.rerender(
    <QueryClientProvider client={client}>
      <LyricsPanel track={{ ...track, id: "yt_second", title: "Second song" }} progress={0} duration={180} seekTo={vi.fn()} open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(screen.queryByText("Old lyrics")).toBeNull();
  expect(screen.getByRole("status")).toHaveTextContent("Загружаем текст");
  resolveSecond({ plainLyrics: null, syncedLyrics: null });
  await waitFor(() => expect(screen.getByText("Текст пока недоступен")).toBeInTheDocument());
});
