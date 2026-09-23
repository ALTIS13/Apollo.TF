import { describe, expect, it } from "vitest";
import { clearUpcoming, insertNext, moveUpcoming } from "./queue-operations";

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
});
