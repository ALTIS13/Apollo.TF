import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const props: React.ComponentProps<typeof LyricsPanel> = {
    track,
    progress: 14,
    duration: 180,
    seekTo,
    open: true,
    onOpenChange: vi.fn(),
    ...overrides,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <LyricsPanel {...props} />
    </QueryClientProvider>,
  );
  return {
    seekTo,
    rerenderPanel: (next: Partial<React.ComponentProps<typeof LyricsPanel>>) => view.rerender(
      <QueryClientProvider client={client}>
        <LyricsPanel {...props} {...next} />
      </QueryClientProvider>,
    ),
  };
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

it("identifies an unverified lyrics fallback without presenting it as a matched recording", async () => {
  tfFetch.mockResolvedValue({
    plainLyrics: "Fallback line",
    syncedLyrics: null,
    source: "lyrics.ovh",
    match: "unverified",
  });
  renderPanel();

  expect(await screen.findByText("Fallback line")).toBeInTheDocument();
  expect(screen.getByText("Источник: lyrics.ovh")).toBeInTheDocument();
  expect(screen.getByText("Совпадение с записью не проверено")).toBeInTheDocument();
});

it("follows the active line, yields to manual scrolling, and resumes on command", async () => {
  tfFetch.mockResolvedValue({
    plainLyrics: null,
    syncedLyrics: "[00:03.00]First line\n[00:12.50]Second line\n[00:18.00]Third line",
  });
  const scrollTo = vi.fn();
  const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });

  try {
    const { rerenderPanel } = renderPanel();
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Перейти к 0:12: Second line" });
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());

    const followButton = screen.getByRole("button", { name: "Следить за текущей строкой" });
    expect(followButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.wheel(screen.getByRole("region", { name: "Текст песни" }));
    expect(followButton).toHaveAttribute("aria-pressed", "false");

    const previousScrolls = scrollTo.mock.calls.length;
    rerenderPanel({ progress: 19 });
    expect(screen.getByRole("button", { name: "Перейти к 0:18: Third line" })).toHaveAttribute("aria-current", "true");
    expect(scrollTo).toHaveBeenCalledTimes(previousScrolls);

    await user.click(followButton);
    expect(followButton).toHaveAttribute("aria-pressed", "true");
    expect(scrollTo).toHaveBeenCalledTimes(previousScrolls + 1);
  } finally {
    if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  }
});
