import { beforeEach, expect, it } from "vitest";
import {
  clearRecentSearches,
  readRecentSearches,
  rememberRecentSearch,
  removeRecentSearch,
} from "./recent-searches";

const accountA = { accountId: "account-a", installationId: "device-a" };
const accountB = { accountId: "account-b", installationId: "device-a" };
const deviceB = { accountId: "account-a", installationId: "device-b" };
const now = 1_800_000_000_000;

beforeEach(() => localStorage.clear());

it("keeps recent searches separate by account and installation and removes only the selected entry", () => {
  rememberRecentSearch(
    accountA,
    { kind: "exact", artist: "Artist", title: "Track" },
    now,
  );
  rememberRecentSearch(
    accountB,
    { kind: "quick", query: "Another song" },
    now + 1,
  );

  expect(readRecentSearches(accountA, now + 1)).toEqual([
    { kind: "exact", artist: "Artist", title: "Track", savedAt: now },
  ]);
  expect(readRecentSearches(accountB, now + 1)).toHaveLength(1);
  expect(readRecentSearches(deviceB, now + 1)).toEqual([]);

  removeRecentSearch(
    accountA,
    readRecentSearches(accountA, now + 1)[0]!,
    now + 1,
  );
  expect(readRecentSearches(accountA, now + 1)).toEqual([]);
  expect(readRecentSearches(accountB, now + 1)).toHaveLength(1);
  clearRecentSearches(accountB);
  expect(readRecentSearches(accountB, now + 1)).toEqual([]);
});

it("deduplicates a repeat and discards expired or malformed local data", () => {
  rememberRecentSearch(accountA, { kind: "quick", query: " Song title " }, now);
  rememberRecentSearch(
    accountA,
    { kind: "quick", query: "song TITLE" },
    now + 5,
  );
  expect(readRecentSearches(accountA, now + 5)).toEqual([
    { kind: "quick", query: "song TITLE", savedAt: now + 5 },
  ]);
  expect(readRecentSearches(accountA, now + 31 * 24 * 60 * 60_000)).toEqual([]);
  expect(
    localStorage.getItem("tf_recent_searches:v1:account-a:device-a"),
  ).toBeNull();

  localStorage.setItem(
    "tf_recent_searches:v1:account-a:device-a",
    JSON.stringify([
      { kind: "quick", query: "Valid", savedAt: now },
      { kind: "exact", artist: "", title: "Invalid", savedAt: now },
      { kind: "quick", query: "Future", savedAt: now + 10 },
    ]),
  );
  expect(readRecentSearches(accountA, now)).toEqual([
    { kind: "quick", query: "Valid", savedAt: now },
  ]);
  expect(
    JSON.parse(
      localStorage.getItem("tf_recent_searches:v1:account-a:device-a")!,
    ),
  ).toEqual([{ kind: "quick", query: "Valid", savedAt: now }]);
});
