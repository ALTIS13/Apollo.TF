import { afterEach, describe, expect, it, vi } from "vitest";
import { createRevokeScheduler } from "./tf-revoke-scheduler.js";
afterEach(() => vi.useRealTimers());
describe("bounded revoke-only scheduler lifecycle", () => {
  it("stopping before the queued first drain starts performs no new work", async () => {
    vi.useFakeTimers();
    const drain = vi.fn(async () => "drained" as const);
    const scheduler = createRevokeScheduler(
      drain,
      () => {},
      () => {},
    );
    scheduler.start();
    await scheduler.stop();
    expect(drain).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("starts one restart drain and never overlaps or accumulates ticks", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const drain = vi.fn(async () => {
      await held;
      return "pending" as const;
    });
    const report = vi.fn();
    const scheduler = createRevokeScheduler(drain, report, () => {});
    expect(drain).not.toHaveBeenCalled();
    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(drain).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(report.mock.calls).toEqual([["pending"]]);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(drain).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(drain).toHaveBeenCalledTimes(2);
    await scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(drain).toHaveBeenCalledTimes(2);
  });
  it("reports only bounded nonsecret outage status and retries on the next interval", async () => {
    vi.useFakeTimers();
    const drain = vi
      .fn(async () => "drained" as const)
      .mockRejectedValueOnce(new Error("secret URL and user record"));
    const report = vi.fn();
    const scheduler = createRevokeScheduler(drain, report, () => {});
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(report.mock.calls).toEqual([["unavailable"]]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(report.mock.calls).toEqual([["unavailable"], ["drained"]]);
    await scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("shutdown cancels owned transport, settles in-flight work, and is idempotent before Redis teardown", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let settle!: () => void;
    const drain = async () => {
      await new Promise<void>((r) => {
        settle = r;
      });
      events.push("settled");
      return "pending" as const;
    };
    const scheduler = createRevokeScheduler(
      drain,
      () => {},
      () => {
        events.push("cancel");
        settle();
      },
    );
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    const close = async () => {
      await scheduler.stop();
      events.push("redis-disconnect");
    };
    await close();
    await scheduler.stop();
    expect(events).toEqual(["cancel", "settled", "redis-disconnect"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
