import { expect, it } from "vitest";
import { planLikedReorder } from "./liked-order";

it("maps a drag to one server move and protects the unloaded-page boundary", () => {
  const current = ["a", "b", "c", "d"];
  expect(planLikedReorder(current, ["a", "c", "b", "d"], "b", false, "7"))
    .toEqual({ type: "move", request: { trackId: "b", beforeTrackId: "d", expectedRevision: "7" } });
  expect(planLikedReorder(current, ["a", "c", "d", "b"], "b", false, "7"))
    .toEqual({ type: "move", request: { trackId: "b", beforeTrackId: null, expectedRevision: "7" } });
  expect(planLikedReorder(current, ["a", "c", "d", "b"], "b", true, "7"))
    .toEqual({ type: "load_more" });
  expect(planLikedReorder(current, current, "b", false, "7"))
    .toEqual({ type: "unchanged" });
  expect(planLikedReorder(current, ["a", "c", "b", "x"], "b", false, "7"))
    .toEqual({ type: "unchanged" });
});
