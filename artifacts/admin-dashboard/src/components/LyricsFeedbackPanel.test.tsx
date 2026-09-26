import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LyricsFeedbackPanel } from "./LyricsFeedbackPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const report = {
  id: 4,
  accountId: "10000000-0000-4000-8000-000000000001",
  trackId: "yt_first",
  artist: "Artist",
  title: "First song",
  lyricsSource: "lrclib",
  reason: "wrong_track",
  createdAt: "2026-09-26T12:00:00.000Z",
  status: "open",
  revision: 1,
  updatedAt: "2026-09-26T12:00:00.000Z",
  resolutionNote: null,
};

it("shows operator-visible lyric reports from the same-origin triage endpoint", async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      schemaVersion: 1,
      reports: [report],
      nextCursor: null,
    }),
  });
  vi.stubGlobal("fetch", fetcher);
  render(<LyricsFeedbackPanel mode="http" refreshKey="first" />);

  expect(await screen.findByText("First song")).toBeInTheDocument();
  expect(screen.getByText("yt_first")).toBeInTheDocument();
  expect(screen.getByText("Не тот трек")).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledWith(
    "/api/admin/lyrics-feedback/triage?status=open",
    expect.objectContaining({ headers: { Accept: "application/json" } }),
  );
  expect(screen.queryByText("10000000-0000-4000-8000-000000000001")).not.toBeInTheDocument();
});

it("submits a review action with its revision and refreshes the queue", async () => {
  const fetcher = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      return { ok: true, json: async () => ({
        schemaVersion: 1,
        report: { ...report, status: "reviewing", revision: 2 },
      }) };
    }
    return { ok: true, json: async () => ({ schemaVersion: 1, reports: [report], nextCursor: null }) };
  });
  vi.stubGlobal("fetch", fetcher);
  render(<LyricsFeedbackPanel mode="http" />);

  fireEvent.click(await screen.findByRole("button", { name: "В работу" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(
    "/api/admin/lyrics-feedback/4",
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ status: "reviewing", expectedRevision: 1 }),
    }),
  ));
});
