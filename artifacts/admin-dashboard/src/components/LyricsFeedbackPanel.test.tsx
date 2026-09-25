import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LyricsFeedbackPanel } from "./LyricsFeedbackPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows operator-visible lyric reports from the exact same-origin endpoint", async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      schemaVersion: 1,
      reports: [{
        id: 4,
        accountId: "10000000-0000-4000-8000-000000000001",
        trackId: "yt_first",
        artist: "Artist",
        title: "First song",
        lyricsSource: "lrclib",
        reason: "wrong_track",
        createdAt: "2026-09-26T12:00:00.000Z",
      }],
    }),
  });
  vi.stubGlobal("fetch", fetcher);
  render(<LyricsFeedbackPanel mode="http" refreshKey="first" />);

  expect(await screen.findByText("First song")).toBeInTheDocument();
  expect(screen.getByText("yt_first")).toBeInTheDocument();
  expect(screen.getByText("Не тот трек")).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledWith(
    "/api/admin/lyrics-feedback",
    expect.objectContaining({ headers: { Accept: "application/json" } }),
  );
  expect(screen.queryByText("10000000-0000-4000-8000-000000000001")).not.toBeInTheDocument();
});
