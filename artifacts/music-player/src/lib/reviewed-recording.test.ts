import { expect, it } from "vitest";
import type { TrackResult } from "@workspace/api-client-react";
import { readQueueSnapshot, writeQueueSnapshot } from "./queue-persistence";
import { parseReviewedTrackId, reviewedMediaPath, reviewedTrackId } from "./reviewed-recording";

const draft = "1abcdef0-0000-4000-8000-000000000012";
const revision = "ab".repeat(32);

it("builds and parses a canonical private binding, then derives only the two fixed media paths", () => {
  const id = `rv_${draft}_199_${revision}`;
  expect(reviewedTrackId(draft, 199, revision)).toBe(id);
  expect(parseReviewedTrackId(id)).toEqual({ draftId: draft, position: 199, revision });
  expect(reviewedMediaPath(id, "audio")).toBe(`/collections/imports/${draft}/entries/199/audio/${revision}`);
  expect(reviewedMediaPath(id, "file")).toBe(`/collections/imports/${draft}/entries/199/file/${revision}`);
});

it.each([
  `rv_${draft.toUpperCase()}_0_${revision}`, `rv_${draft}_00_${revision}`, `rv_${draft}_200_${revision}`,
  `rv_${draft}_-1_${revision}`, `rv_${draft}_1.5_${revision}`, `rv_${draft}_0_${revision.toUpperCase()}`,
  `rv_${draft}_0_${revision.slice(1)}`, `rv_${draft}_0_${revision}\n`, `rv_${draft}_0_${revision}?path=elsewhere`,
  `rv_../_0_${revision}`, `https://example.test/rv_${draft}_0_${revision}`,
])("rejects noncanonical ID %j without a path", (id) => {
  expect(parseReviewedTrackId(id)).toBeNull();
  expect(reviewedMediaPath(id, "audio")).toBeNull();
});

it("clears an existing snapshot instead of persisting a mixed queue or restoring the previous queue", () => {
  const identity = { accountId: "queue-test", installationId: "reviewed-test" };
  const track: TrackResult = { id: "yt_previous", artist: "Artist", title: "Previous", duration: 180,
    thumbnailUrl: null, source: "youtube", type: "original", quality: [], score: 0 };
  expect(writeQueueSnapshot(localStorage, identity, [track], 0, 12)).toBe(true);
  expect(readQueueSnapshot(localStorage, identity)?.queue[0].id).toBe(track.id);
  expect(writeQueueSnapshot(localStorage, identity, [track, {
    ...track, source: "reviewed", id: `rv_${draft}_0_${revision}`,
  }], 0, 12)).toBe(true);
  expect(readQueueSnapshot(localStorage, identity)).toBeNull();
  expect(localStorage.getItem("apollo_tf_queue_v1:queue-test:reviewed-test")).toBeNull();
});
