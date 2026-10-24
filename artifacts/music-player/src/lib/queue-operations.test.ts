import { describe, expect, it } from "vitest";
import { clearUpcoming, getNextQueueIndex, insertNext, moveUpcoming, reorderUpcoming, shuffleUpcomingIds } from "./queue-operations";

describe("queue operations", () => {
  it("inserts a track immediately after the current item without losing history", () => {
    expect(insertNext(["played", "current", "later"], 1, "next")).toEqual([
      "played", "current", "next", "later",
    ]);
    expect(insertNext([], 0, "first")).toEqual(["first"]);
    expect(insertNext(["later"], -1, "first")).toEqual(["first", "later"]);
  });

  it("moves only upcoming entries, including duplicate tracks by position", () => {
    const queue = ["played", "current", "same", "other", "same"];
    expect(moveUpcoming(queue, 1, 4, 2)).toEqual([
      "played", "current", "same", "same", "other",
    ]);
    expect(moveUpcoming(queue, 1, 1, 3)).toBe(queue);
    expect(moveUpcoming(queue, 1, 3, 1)).toBe(queue);
    expect(moveUpcoming(["first", "second"], -1, 1, 0)).toEqual(["second", "first"]);
  });

  it("clears upcoming items while the current track continues", () => {
    expect(clearUpcoming(["played", "current", "next"], 1, true)).toEqual([
      "played", "current",
    ]);
    expect(clearUpcoming(["queued"], 0, false)).toEqual([]);
  });

  it("advances on natural end according to repeat mode, while explicit next skips repeat-one", () => {
    expect(getNextQueueIndex(3, 1, "one", "ended")).toBe(1);
    expect(getNextQueueIndex(3, 1, "one", "next")).toBe(2);
    expect(getNextQueueIndex(3, 2, "one", "next")).toBeNull();
    expect(getNextQueueIndex(3, 2, "off", "ended")).toBeNull();
    expect(getNextQueueIndex(3, 2, "all", "ended")).toBe(0);
    expect(getNextQueueIndex(3, 2, "all", "next")).toBe(0);
    expect(getNextQueueIndex(1, 0, "all", "next")).toBe(0);
    expect(getNextQueueIndex(0, 0, "all", "next")).toBeNull();
  });

  it("shuffles only upcoming occurrence identities and restores them despite duplicate track IDs", () => {
    const same = { id: "duplicate" };
    const other = { id: "other" };
    const queue = [same, other, same, other, same];
    const ids = [10, 11, 12, 13, 14];
    const shuffledIds = shuffleUpcomingIds(ids, 1, () => 0);
    expect(shuffledIds.slice(0, 2)).toEqual([10, 11]);
    expect(shuffledIds.slice(2)).toEqual([13, 14, 12]);
    const shuffled = reorderUpcoming(queue, ids, 1, shuffledIds);
    expect(shuffled.queue.slice(0, 2)).toEqual(queue.slice(0, 2));
    expect(shuffled.queue[2]).toBe(other);
    expect(shuffled.ids).toEqual(shuffledIds);
    const restored = reorderUpcoming(shuffled.queue, shuffled.ids, 1, ids);
    expect(restored.queue).toEqual(queue);
    expect(restored.ids).toEqual(ids);
  });
});
