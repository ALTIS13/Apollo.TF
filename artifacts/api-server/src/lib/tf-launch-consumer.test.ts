import type { ModuleLaunchAdmissionV1 } from "@workspace/platform-contract/v1";
import { describe, expect, it, vi } from "vitest";

import {
  consumeTfLaunch,
  type TfLaunchVerifiedContext,
} from "./tf-launch-consumer.js";

const now = Date.parse("2026-11-13T00:00:00.000Z");
const launchId = "launch_opaque_1";
const accountId = "10000000-0000-4000-8000-000000000001";
const installationId = "20000000-0000-4000-8000-000000000002";
const instant = (offset: number) => new Date(now + offset).toISOString();
const principal: TfLaunchVerifiedContext = {
  accountId,
  installationId,
  entitlements: [
    "tf.search",
    "tf.collections",
    "tf.integrations",
    "tf.admin.observe",
  ],
  sessionExpiresAt: instant(120_000),
  policyFreshUntil: instant(30_000),
};
const admission = {
  schema_version: 1,
  launch_id: launchId,
  account_subject: accountId,
  installation_id: installationId,
  module_code: "TF",
  decision: "ALLOW",
  target_kind: "WEB",
  target_uri: "https://untrusted.example.test/admin?intent=private-canary",
  opaque_state: "private-opaque-state-canary",
  issued_at: instant(-1_000),
  expires_at: instant(59_000),
  one_time: true,
  entitlement_snapshot_revision: "snapshot-1",
  policy_revision: "policy-1",
  request_id: "40000000-0000-4000-8000-000000000004",
  audit_correlation_id: "50000000-0000-4000-8000-000000000005",
} satisfies ModuleLaunchAdmissionV1;

function consume(outcome: unknown, currentPrincipal = principal) {
  const redeemOnce = vi.fn().mockResolvedValue(outcome);
  return {
    redeemOnce,
    result: consumeTfLaunch(currentPrincipal, launchId, {
      redeemOnce,
      now: () => now,
    }),
  };
}

function consumed(name?: string, receipt: unknown = admission) {
  return {
    status: "consumed",
    admission: receipt,
    ...(name === undefined ? {} : { route: { name } }),
  };
}

describe("TF native launch consumer", () => {
  it.each([
    ["home", "/"],
    ["search", "/"],
    ["collection", "/favorites"],
    ["integrations", "/integrations"],
  ])(
    "maps a consumed %s route without using the issuance URI",
    async (route, path) => {
      const current = consume(consumed(route));
      await expect(current.result).resolves.toEqual({
        status: "admitted",
        path,
      });
      expect(current.redeemOnce).toHaveBeenCalledExactlyOnceWith({
        launchId,
        accountId,
        installationId,
        moduleCode: "TF",
      });
    },
  );

  it("honors authoritative one-time consumption and never grants a replay", async () => {
    const redeemOnce = vi
      .fn()
      .mockResolvedValueOnce(consumed("search"))
      .mockResolvedValueOnce({ status: "rejected", reason: "replayed" });
    const dependencies = { redeemOnce, now: () => now };
    await expect(
      consumeTfLaunch(principal, launchId, dependencies),
    ).resolves.toEqual({ status: "admitted", path: "/" });
    await expect(
      consumeTfLaunch(principal, launchId, dependencies),
    ).resolves.toEqual({ status: "rejected", reason: "replayed" });
    expect(redeemOnce).toHaveBeenCalledTimes(2);
  });

  it("does not retry or fall back when redemption may have been consumed", async () => {
    const redeemOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error("private transport failure"))
      .mockResolvedValueOnce(consumed("home"));
    const unknown = {
      status: "indeterminate",
      reason: "redemption_unknown_no_replay",
    };
    await expect(
      consumeTfLaunch(principal, launchId, { redeemOnce, now: () => now }),
    ).resolves.toEqual(unknown);
    expect(redeemOnce).toHaveBeenCalledOnce();
    await expect(consume({ status: "indeterminate" }).result).resolves.toEqual(
      unknown,
    );
    await expect(consume(admission).result).resolves.toEqual(unknown);
  });

  it.each([
    ["launch_id", "different_launch"],
    ["account_subject", "different_account"],
    ["installation_id", "different_installation"],
    ["module_code", "AI"],
    ["module_code", "tf"],
  ])("rejects a consumed receipt with mismatched %s", async (field, value) => {
    const current = consume(consumed("home", { ...admission, [field]: value }));
    await expect(current.result).resolves.toEqual({
      status: "rejected",
      reason: "binding_mismatch",
    });
    expect(current.redeemOnce).toHaveBeenCalledOnce();
  });

  it.each([
    ["expires exactly now", instant(-1_000), instant(0), "expired"],
    ["not yet issued", instant(1), instant(2_000), "not_yet_valid"],
    [
      "exceeds 60 seconds",
      instant(-1_000),
      instant(59_001),
      "invalid_lifetime",
    ],
    [
      "exceeds 60 seconds at sub-millisecond precision",
      instant(-1_000),
      instant(59_000).replace(".000Z", ".000001Z"),
      "invalid_lifetime",
    ],
    [
      "sub-millisecond future issuance",
      instant(0).replace(".000Z", ".000001Z"),
      instant(2_000),
      "not_yet_valid",
    ],
  ])(
    "rejects a grant that %s",
    async (_label, issued_at, expires_at, reason) => {
      const current = consume(
        consumed("home", { ...admission, issued_at, expires_at }),
      );
      await expect(current.result).resolves.toEqual({
        status: "rejected",
        reason,
      });
      expect(current.redeemOnce).toHaveBeenCalledOnce();
    },
  );

  it("checks policy freshness and grant expiry again after the authoritative call", async () => {
    const redeemOnce = vi.fn().mockResolvedValue(consumed("search"));
    const clock = vi
      .fn()
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now + 30_000);
    await expect(
      consumeTfLaunch(principal, launchId, { redeemOnce, now: clock }),
    ).resolves.toEqual({ status: "rejected", reason: "principal_not_current" });
    redeemOnce.mockResolvedValueOnce(
      consumed("search", { ...admission, expires_at: instant(1_000) }),
    );
    clock.mockReturnValueOnce(now).mockReturnValueOnce(now + 1_000);
    await expect(
      consumeTfLaunch(principal, launchId, { redeemOnce, now: clock }),
    ).resolves.toEqual({ status: "rejected", reason: "expired" });
    expect(redeemOnce).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ sessionExpiresAt: instant(0) }, "principal_not_current"],
    [{ policyFreshUntil: instant(0) }, "principal_not_current"],
    [{ policyFreshUntil: "not-a-timestamp" }, "principal_not_current"],
    [
      { entitlements: ["tf.collections", "tf.integrations"] },
      "capability_denied",
    ],
  ])(
    "rejects an inadmissible principal before spending a launch ID",
    async (overrides, reason) => {
      const current = consume(consumed("home"), { ...principal, ...overrides });
      await expect(current.result).resolves.toEqual({
        status: "rejected",
        reason,
      });
      expect(current.redeemOnce).not.toHaveBeenCalled();
    },
  );

  it.each([
    "",
    " launch",
    "a".repeat(129),
    "https://example.test/x",
    "bad\nlaunch",
    "launch\n",
    "launch\r",
    "launch\u2028",
  ])("rejects invalid launch ID %j without redemption", async (id) => {
    const redeemOnce = vi.fn();
    await expect(
      consumeTfLaunch(principal, id, { redeemOnce, now: () => now }),
    ).resolves.toEqual({ status: "rejected", reason: "invalid_launch_id" });
    expect(redeemOnce).not.toHaveBeenCalled();
  });

  it.each(["collection", "integrations"])(
    "requires the additional local capability for %s",
    async (route) => {
      const current = consume(consumed(route), {
        ...principal,
        entitlements: ["tf.search"],
      });
      await expect(current.result).resolves.toEqual({
        status: "rejected",
        reason: "capability_denied",
      });
      expect(current.redeemOnce).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [consumed(undefined, { ...admission, route: "home" }), "route_unavailable"],
    [consumed("admin"), "route_not_allowed"],
    [consumed("https://untrusted.example.test/"), "route_not_allowed"],
    [
      {
        ...consumed("collection"),
        route: { name: "collection", resourceRef: "playlist-123" },
      },
      "route_not_allowed",
    ],
    [
      consumed("collection", { ...admission, resource_ref: "playlist-123" }),
      "route_not_allowed",
    ],
    [
      consumed("search", { ...admission, one_time: false }),
      "invalid_admission",
    ],
    [
      consumed("search", { ...admission, target_uri: "not-a-url" }),
      "invalid_admission",
    ],
  ])(
    "fails closed for unsupported, unprojected, or invalid receipt %j",
    async (outcome, reason) => {
      const current = consume(outcome);
      await expect(current.result).resolves.toEqual({
        status: "rejected",
        reason,
      });
      expect(current.redeemOnce).toHaveBeenCalledOnce();
    },
  );

  it("returns a stable denial for a common Platform DENY without exposing its reason", async () => {
    const deny = {
      ...admission,
      decision: "DENY",
      reason_code: "not_entitled",
      target_kind: null,
      target_uri: null,
      opaque_state: null,
    } satisfies ModuleLaunchAdmissionV1;
    await expect(consume(consumed("home", deny)).result).resolves.toEqual({
      status: "rejected",
      reason: "denied",
    });
    await expect(
      consume({ status: "rejected", reason: "not_found" }).result,
    ).resolves.toEqual({ status: "rejected", reason: "not_found" });
  });
});
