import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Discover from "./Discover";

const tfFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tf-session-client", () => ({ tfFetch }));
vi.mock("@/hooks/use-liked-collection", () => ({
  useLikedTrackLookup: () => ({
    data: { likedTrackIds: [] },
    isFetching: false,
  }),
}));
vi.mock("@/components/TrackCard", () => ({ TrackCard: () => null }));
vi.mock("@/components/CollectionActions", () => ({
  CollectionActions: () => null,
}));

afterEach(() => {
  cleanup();
  tfFetch.mockReset();
});

it("labels recommendations from saved tracks without claiming a listening history", async () => {
  tfFetch.mockResolvedValue({
    basis: "liked_tracks",
    results: [
      {
        id: "yt_saved-artist-track",
        title: "New Track",
        artist: "Saved Artist",
        source: "youtube",
        type: "original",
        duration: 180,
        thumbnailUrl: null,
        quality: ["128"],
        score: 90,
      },
    ],
  });

  render(<Discover />);

  expect(
    await screen.findByText("По вашим сохранённым трекам"),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("На основе вашей истории прослушиваний"),
  ).not.toBeInTheDocument();
});

it("keeps a neutral label for an unknown recommendation basis", async () => {
  tfFetch.mockResolvedValue({ basis: "toString", results: [] });

  render(<Discover />);

  await screen.findByText("Пока нет рекомендаций");
  expect(screen.getByText("Подборка для вас")).toBeInTheDocument();
});
