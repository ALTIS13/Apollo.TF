import { describe, expect, it, vi } from "vitest";

import {
  createMediaLinkAdmission,
  MediaLinkAdmissionError,
} from "./media-link-admission.js";

const metadata = {
  schemaVersion: 1 as const,
  source: "youtube" as const,
  title: "Track",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("media link admission", () => {
  it("admits two active resolutions without queueing a third", async () => {
    const admit = createMediaLinkAdmission();
    const firstTask = deferred<typeof metadata>();
    const secondTask = deferred<typeof metadata>();
    const first = admit("account-a", "https://example.test/first", () => firstTask.promise);
    const second = admit("account-b", "https://example.test/second", () => secondTask.promise);
    const blockedTask = vi.fn(async () => metadata);

    await expect(admit("account-c", "https://example.test/third", blockedTask))
      .rejects.toMatchObject({ code: "media_link_overloaded", retryAfterSeconds: 1 });
    expect(blockedTask).not.toHaveBeenCalled();

    firstTask.resolve(metadata);
    await expect(first).resolves.toEqual(metadata);
    await expect(admit("account-c", "https://example.test/third", blockedTask))
      .resolves.toEqual(metadata);
    expect(blockedTask).toHaveBeenCalledTimes(1);
    secondTask.resolve(metadata);
    await second;
  });

  it("single-flights only the same account and URL, with bounded followers", async () => {
    const admit = createMediaLinkAdmission({ maxFollowersPerFlight: 1, maxRequestsPerAccount: 1 });
    const task = deferred<typeof metadata>();
    const resolve = vi.fn(() => task.promise);
    const first = admit("account-a", "https://example.test/track", resolve);
    const joined = admit("account-a", "https://example.test/track", resolve);

    await expect(admit("account-a", "https://example.test/track", resolve))
      .rejects.toMatchObject({ code: "media_link_overloaded" });
    await expect(admit("account-a", "https://example.test/other", resolve))
      .rejects.toMatchObject({ code: "media_link_rate_limited" });
    const otherAccount = admit("account-b", "https://example.test/track", resolve);
    await Promise.resolve();
    expect(resolve).toHaveBeenCalledTimes(2);

    task.resolve(metadata);
    await expect(Promise.all([first, joined, otherAccount])).resolves.toEqual([
      metadata, metadata, metadata,
    ]);
  });

  it("expires per-account budgets and bounds account state", async () => {
    let now = 0;
    const admit = createMediaLinkAdmission({
      maxRequestsPerAccount: 2,
      maxAccountStates: 2,
      windowMs: 5_000,
      now: () => now,
    });
    const resolve = async () => metadata;
    await admit("account-a", "url-1", resolve);
    await admit("account-a", "url-2", resolve);
    await admit("account-b", "url-1", resolve);

    await expect(admit("account-a", "url-3", resolve)).rejects.toMatchObject({
      code: "media_link_rate_limited", retryAfterSeconds: 5,
    });
    await expect(admit("account-c", "url-1", resolve)).rejects.toMatchObject({
      code: "media_link_overloaded",
    });
    now = 4_999;
    await expect(admit("account-a", "url-3", resolve)).rejects.toMatchObject({
      code: "media_link_rate_limited", retryAfterSeconds: 1,
    });
    now = 5_000;
    await expect(admit("account-c", "url-1", resolve)).resolves.toEqual(metadata);
  });

  it("releases the slot and single-flight key when the task throws", async () => {
    const admit = createMediaLinkAdmission({ maxActive: 1 });
    const task = deferred<typeof metadata>();
    const failure = new Error("private provider error");
    const first = admit("account-a", "https://example.test/track", () => task.promise);
    const joined = admit("account-a", "https://example.test/track", () => task.promise);
    task.reject(failure);

    await expect(first).rejects.toBe(failure);
    await expect(joined).rejects.toBe(failure);
    await expect(admit("account-a", "https://example.test/track", async () => metadata))
      .resolves.toEqual(metadata);

    await expect(admit("account-a", "https://example.test/other", () => {
      throw failure;
    })).rejects.toBe(failure);
    await expect(admit("account-a", "https://example.test/other", async () => metadata))
      .resolves.toEqual(metadata);
  });

  it("uses typed stable admission errors", () => {
    const error = new MediaLinkAdmissionError("media_link_rate_limited", 7);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("media_link_rate_limited");
    expect(error.retryAfterSeconds).toBe(7);
  });
});
