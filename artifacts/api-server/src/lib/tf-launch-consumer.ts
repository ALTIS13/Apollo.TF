import {
  moduleLaunchAdmissionV1Schema,
  type ModuleLaunchAdmissionV1,
} from "@workspace/platform-contract/v1";

import type { TfPrincipal } from "./tf-policy.js";

/** Only a server-side verifier may supply this context; it is not a request DTO. */
export type TfLaunchVerifiedContext = Pick<
  TfPrincipal,
  | "accountId"
  | "installationId"
  | "entitlements"
  | "sessionExpiresAt"
  | "policyFreshUntil"
>;

export interface TfLaunchRedemptionBinding {
  readonly launchId: string;
  readonly accountId: string;
  readonly installationId: string;
  readonly moduleCode: "TF";
}

type AuthoritativeRejection = "denied" | "replayed" | "expired" | "not_found";

/** Internal projection after atomic redemption. An issuance DTO is not proof of consumption. */
export type TfLaunchRedeemOutcome =
  | {
      readonly status: "consumed";
      readonly admission: unknown;
      readonly route?: {
        readonly name:
          | "home"
          | "search"
          | "collection"
          | "integrations"
          | "admin";
        readonly resourceRef?: string;
      };
    }
  | { readonly status: "rejected"; readonly reason: AuthoritativeRejection }
  | { readonly status: "indeterminate" };

export interface TfLaunchConsumerDependencies {
  /**
   * Bind and atomically consume at the authority. The adapter must bound its own
   * transport timeout and must not retry; an uncertain outcome is indeterminate.
   */
  readonly redeemOnce: (
    binding: TfLaunchRedemptionBinding,
  ) => Promise<TfLaunchRedeemOutcome>;
  readonly now?: () => number;
}

type RejectionReason =
  | AuthoritativeRejection
  | "invalid_launch_id"
  | "principal_not_current"
  | "capability_denied"
  | "binding_mismatch"
  | "invalid_admission"
  | "invalid_lifetime"
  | "not_yet_valid"
  | "route_unavailable"
  | "route_not_allowed";

export type TfLaunchConsumeResult =
  | {
      readonly status: "admitted";
      readonly path: "/" | "/favorites" | "/integrations";
    }
  | { readonly status: "rejected"; readonly reason: RejectionReason }
  // Terminal for this launch ID. Callers must not replay or fall back.
  | {
      readonly status: "indeterminate";
      readonly reason: "redemption_unknown_no_replay";
    };

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_LIFETIME_MS = 60_000;

type Instant = {
  readonly milliseconds: number;
  readonly submillisecond: string;
};

function parseInstant(value: string): Instant | null {
  if (value.length > 128) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  // Preserve fractional precision that Date.parse truncates at either edge.
  const submillisecond =
    /\.\d{3}(\d+)/.exec(value)?.[1]?.replace(/0+$/, "") ?? "";
  return { milliseconds, submillisecond };
}

function readClock(clock: () => number): Instant | null {
  try {
    const milliseconds = clock();
    return Number.isSafeInteger(milliseconds) && milliseconds >= 0
      ? { milliseconds, submillisecond: "" }
      : null;
  } catch {
    return null;
  }
}

function before(left: Instant, right: Instant): boolean {
  return (
    left.milliseconds < right.milliseconds ||
    (left.milliseconds === right.milliseconds &&
      left.submillisecond < right.submillisecond)
  );
}

function reject(reason: RejectionReason): TfLaunchConsumeResult {
  return { status: "rejected", reason };
}

function indeterminate(): TfLaunchConsumeResult {
  return { status: "indeterminate", reason: "redemption_unknown_no_replay" };
}

function parseAdmission(value: unknown): ModuleLaunchAdmissionV1 | null {
  try {
    const parsed = moduleLaunchAdmissionV1Schema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function carriesResourceRef(value: object): boolean {
  return (
    Object.hasOwn(value, "resource_ref") || Object.hasOwn(value, "resourceRef")
  );
}

export async function consumeTfLaunch(
  context: TfLaunchVerifiedContext,
  launchId: string,
  dependencies: TfLaunchConsumerDependencies,
): Promise<TfLaunchConsumeResult> {
  if (!OPAQUE_ID.test(launchId)) return reject("invalid_launch_id");
  const { accountId, installationId } = context;
  const clock = dependencies.now ?? Date.now;
  const started = readClock(clock);
  const sessionExpiry = parseInstant(context.sessionExpiresAt);
  const policyExpiry = parseInstant(context.policyFreshUntil);
  if (
    !OPAQUE_ID.test(accountId) ||
    !OPAQUE_ID.test(installationId) ||
    !started ||
    !sessionExpiry ||
    !policyExpiry ||
    !before(started, sessionExpiry) ||
    !before(started, policyExpiry)
  ) {
    return reject("principal_not_current");
  }
  const entitlements = context.entitlements;
  if (!entitlements.includes("tf.search")) return reject("capability_denied");

  let outcome: TfLaunchRedeemOutcome;
  try {
    outcome = await dependencies.redeemOnce(
      Object.freeze({ launchId, accountId, installationId, moduleCode: "TF" }),
    );
  } catch {
    return indeterminate();
  }
  if (!outcome || !Object.hasOwn(outcome, "status")) return indeterminate();
  if (outcome.status === "rejected") {
    switch (outcome.reason) {
      case "denied":
      case "replayed":
      case "expired":
      case "not_found":
        return reject(outcome.reason);
      default:
        return indeterminate();
    }
  }
  if (outcome.status !== "consumed") return indeterminate();

  const admission = parseAdmission(outcome.admission);
  if (!admission) return reject("invalid_admission");
  if (
    admission.module_code !== "TF" ||
    admission.launch_id !== launchId ||
    admission.account_subject !== accountId ||
    admission.installation_id !== installationId
  ) {
    return reject("binding_mismatch");
  }
  if (admission.decision !== "ALLOW") return reject("denied");

  const completed = readClock(clock);
  if (
    !completed ||
    before(completed, started) ||
    !before(completed, sessionExpiry) ||
    !before(completed, policyExpiry)
  ) {
    return reject("principal_not_current");
  }
  const issued = parseInstant(admission.issued_at);
  const expires = parseInstant(admission.expires_at);
  if (
    !issued ||
    !expires ||
    before(
      { ...issued, milliseconds: issued.milliseconds + MAX_LIFETIME_MS },
      expires,
    )
  ) {
    return reject("invalid_lifetime");
  }
  if (before(completed, issued)) return reject("not_yet_valid");
  if (!before(completed, expires)) return reject("expired");

  // target_uri and opaque_state are never used to select a route.
  if (carriesResourceRef(admission) || carriesResourceRef(outcome))
    return reject("route_not_allowed");
  const route = Object.hasOwn(outcome, "route") ? outcome.route : undefined;
  if (route === undefined) return reject("route_unavailable");
  if (
    !route ||
    typeof route !== "object" ||
    !Object.hasOwn(route, "name") ||
    Object.keys(route).length !== 1
  ) {
    return reject("route_not_allowed");
  }
  switch (route.name) {
    case "home":
    case "search":
      return { status: "admitted", path: "/" };
    case "collection":
      return entitlements.includes("tf.collections")
        ? { status: "admitted", path: "/favorites" }
        : reject("capability_denied");
    case "integrations":
      return entitlements.includes("tf.integrations")
        ? { status: "admitted", path: "/integrations" }
        : reject("capability_denied");
    default:
      return reject("route_not_allowed");
  }
}
