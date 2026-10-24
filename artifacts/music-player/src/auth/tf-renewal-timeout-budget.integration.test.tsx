import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TfAuthProvider, useTfAuth, type TfAuthContextValue } from "./tf-auth";
import {
  canUseTfProtectedActivity,
  clearTfSessionSecurityState,
  reportTfAuthError,
  TfApiError,
} from "@/lib/tf-session-client";

let auth: TfAuthContextValue;
let stalledStage: "context" | "renew";
let recover: boolean;
let paths: string[];
let pending: Array<{
  stage: string;
  resolve: (r: Response) => void;
  signal: AbortSignal;
}>;
const csrf = "a".repeat(42) + "A";
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
function Probe() {
  auth = useTfAuth();
  return <span>{auth.status}</span>;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
  clearTfSessionSecurityState();
  recover = false;
  stalledStage = "renew";
  paths = [];
  pending = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url, "https://tf.apollot.ru").pathname;
    paths.push(path);
    if (path.endsWith("/auth/me")) {
      const response = json({
        accountId: "11111111-1111-4111-8111-111111111111",
        installationId: "22222222-2222-4222-8222-222222222222",
        entitlements: ["tf.search"],
        csrfToken: csrf,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
      response.headers.set("Apollo-TF-Session-Profile", "renewal-v1");
      return response;
    }
    const stage = path.endsWith("/renew-context") ? "context" : "renew";
    if (!recover && stage === stalledStage) {
      // Deliberately ignores cancellation, modeling a command already delivered.
      return new Promise<Response>((resolve) =>
        pending.push({ stage, resolve, signal: init.signal! }),
      );
    }
    return stage === "context"
      ? json({ csrf_token: csrf })
      : new Response(null, { status: 204 });
  });
});
afterEach(() => {
  cleanup();
  clearTfSessionSecurityState();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function wake() {
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    for (let n = 0; n < 15; n++) await Promise.resolve();
  });
}
async function expiredEvent() {
  await act(async () => {
    reportTfAuthError(
      new TfApiError(401, "TF_RENEWAL_ACCESS_EXPIRED", "expired"),
    );
    for (let n = 0; n < 15; n++) await Promise.resolve();
  });
}
async function start() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TfAuthProvider>
        <Probe />
      </TfAuthProvider>
    </QueryClientProvider>,
  );
  await advance(0);
  expect(auth.status).toBe("authenticated");
  await advance(240_000);
  expect(pending).toHaveLength(1);
}
it.each(["context", "renew"] as const)(
  "caps consecutive %s timeouts at three automatic attempts, then allows deliberate recovery",
  async (stage) => {
    stalledStage = stage;
    await start();
    // First timeout at250; backoff retry251; second timeout261; third starts262.
    for (let n = 0; n < 3; n++) {
      await advance(10_000);
      await wake();
      await advance(1000);
      await wake();
    }
    expect(pending).toHaveLength(3);
    expect(pending.every((p) => p.signal.aborted)).toBe(true);
    expect(auth.status).toBe("unavailable");
    expect(canUseTfProtectedActivity()).toBe(false);
    const exhaustedPaths = [...paths];
    await expiredEvent(); //This entry bypasses the wake handler's retryAt check.
    expect(paths).toEqual(exhaustedPaths);
    await advance(26_000); //299: still inside the first automatic cycle.
    await wake();
    expect(paths).toEqual(exhaustedPaths);
    await advance(1000); //The access deadline is another automatic entry path.
    await wake();
    expect(paths).toEqual(exhaustedPaths);
    recover = true;
    await act(async () => {
      await auth.refresh();
    });
    expect(auth.status).toBe("authenticated");
    expect(canUseTfProtectedActivity()).toBe(true);
    const recoveredSession = auth.session;
    const recoveredPaths = [...paths];
    await act(async () => {
      pending.forEach((p) =>
        p.resolve(
          p.stage === "context"
            ? json({ csrf_token: csrf })
            : new Response(null, { status: 204 }),
        ),
      );
      for (let n = 0; n < 15; n++) await Promise.resolve();
    });
    expect(paths).toEqual(recoveredPaths);
    expect(auth.session).toBe(recoveredSession);
  },
);
it("focus and visibility cannot bypass timeout backoff or overlap the next retry", async () => {
  await start();
  await advance(10_000);
  await wake();
  await expiredEvent();
  expect(pending).toHaveLength(1);
  await advance(999);
  await wake();
  expect(pending).toHaveLength(1);
  await advance(1);
  await wake();
  expect(pending).toHaveLength(2);
  expect(pending[0].signal.aborted).toBe(true);
  expect(pending[1].signal.aborted).toBe(false);
});
