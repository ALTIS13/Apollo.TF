import { describe, expect, it } from "vitest";
import { parseSyncedLyrics } from "./lyrics";

describe("parseSyncedLyrics", () => {
  it("orders repeated timestamps and ignores metadata and invalid lines", () => {
    expect(parseSyncedLyrics([
      "[ar:Artist]",
      "[00:12.50][00:24.500]Second line",
      "[00:03.2]First line",
      "[01:99.00]Invalid",
      "[00:16.00]",
    ].join("\n"))).toEqual([
      { time: 3.2, text: "First line" },
      { time: 12.5, text: "Second line" },
      { time: 24.5, text: "Second line" },
    ]);
  });
});
