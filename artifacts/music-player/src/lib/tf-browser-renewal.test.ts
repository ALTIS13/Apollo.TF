import { afterEach, describe, expect, it, vi } from "vitest";
import * as client from "./tf-session-client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const session = () => ({
  accountId: "11111111-1111-4111-8111-111111111111",
  installationId: "22222222-2222-4222-8222-222222222222",
  entitlements: ["tf.search"],
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
  csrfToken: "a".repeat(42) + "A",
});
afterEach(() => {
  client.clearTfSessionSecurityState();
  vi.unstubAllGlobals();
});
describe("local browser renewal protocol", () => {
  it("preserves exact short-expired code without publishing authentication", async () => {
    vi.stubGlobal("fetch", async () =>
      json({ code: "TF_RENEWAL_ACCESS_EXPIRED", retryable: false }, 401),
    );
    await expect(client.renewTfSession()).rejects.toMatchObject({
      code: "TF_RENEWAL_ACCESS_EXPIRED",
      kind: "expired",
    });
  });
  it("uses cookie-bound context then empty-json renew204, without committing the context as access", async () => {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return url.endsWith("renew-context")
        ? json({ csrf_token: "b".repeat(42) + "A" })
        : new Response(null, { status: 204 });
    });
    expect(typeof client.renewTfSession).toBe("function");
    await client.renewTfSession();
    expect(
      calls.map(([url]) => new URL(url, "https://tf.apollot.ru").pathname),
    ).toEqual(["/api/auth/renew-context", "/api/auth/renew"]);
    for (const [, init] of calls) {
      expect(init.credentials).toBe("include");
      expect(init.method).toBe("POST");
      expect(init.body).toBe("{}");
      expect(new Headers(init.headers).get("Content-Type")).toBe(
        "application/json",
      );
    }
    expect(new Headers(calls[0][1].headers).has("X-CSRF-Token")).toBe(false);
    expect(new Headers(calls[1][1].headers).get("X-CSRF-Token")).toBe(
      "b".repeat(42) + "A",
    );
    expect(() => client.tfRequestInit({ method: "POST" })).toThrow();
  });
  it.each([
    { csrf_token: "bad" },
    { csrf_token: "b".repeat(42) + "A", account_id: "unexpected" },
  ])("rejects malformed context before renew: %j", async (body) => {
    const fetch = vi.fn(async () => json(body));
    vi.stubGlobal("fetch", fetch);
    expect(typeof client.renewTfSession).toBe("function");
    await expect(client.renewTfSession()).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    [401, "TF_RENEWAL_SESSION_REVOKED", false, "unauthenticated"],
    [403, "TF_RENEWAL_ACCESS_DENIED", false, "forbidden"],
    [503, "TF_RENEWAL_AUTHORITY_UNAVAILABLE", true, "unavailable"],
    [503, "TF_RENEWAL_INVALID_CLIENT", false, "unavailable"],
    [401, "TF_RENEWAL_UNKNOWN", false, "invalid"],
    [401, "TF_RENEWAL___proto__", false, "invalid"],
    [401, "TF_RENEWAL_ACCESS_EXPIRED", true, "invalid"],
  ])("strict error %s %s", async (status, code, retryable, kind) => {
    vi.stubGlobal("fetch", async () =>
      json({ code, retryable }, status as number),
    );
    await expect(client.renewTfSession()).rejects.toMatchObject({ kind });
  });
  it("only exact response header opts the in-memory snapshot into renewal", async () => {
    vi.stubGlobal("fetch", async () => {
      const r = json(session());
      r.headers.set("Apollo-TF-Session-Profile", "renewal-v1");
      return r;
    });
    expect((await client.fetchTfSession()).renewalProfile).toBe("renewal-v1");
    vi.stubGlobal("fetch", async () => {
      const r = json(session());
      r.headers.set("Apollo-TF-Session-Profile", "future");
      return r;
    });
    expect((await client.fetchTfSession()).renewalProfile).toBeUndefined();
  });
  it("late protected401 cannot clear a newly committed session", async () => {
    client.commitTfSessionSecurityState(session());
    let resolve!: (r: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const pending = client.tfFetch("/tracks/old").catch((e) => e);
    client.commitTfSessionSecurityState({
      ...session(),
      accountId: "33333333-3333-4333-8333-333333333333",
      csrfToken: "c".repeat(42) + "A",
    });
    resolve(json({ error: "unauthorized" }, 401));
    const error = await pending;
    client.reportTfAuthError(error);
    expect(
      new Headers(client.tfRequestInit({ method: "POST" }).headers).get(
        "X-CSRF-Token",
      ),
    ).toBe("c".repeat(42) + "A");
  });
  it("does not issue a protected GET after local logout", async () => {
    client.commitTfSessionSecurityState(session());
    client.clearTfSessionSecurityState();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(client.tfFetch("/tracks/private")).rejects.toMatchObject({
      kind: "unauthenticated",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a delayed protected success from the previous account", async () => {
    client.commitTfSessionSecurityState(session());
    let resolve!: (r: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const pending = client.tfFetch("/private").catch((e) => e);
    client.clearTfSessionSecurityState();
    client.commitTfSessionSecurityState({
      ...session(),
      accountId: "33333333-3333-4333-8333-333333333333",
    });
    resolve(json({ private: "account-a" }));
    expect(await pending).toBeInstanceOf(client.TfApiError);
  });
  it("malformed me401 with a profile cannot initiate recovery", async () => {
    vi.stubGlobal("fetch", async () => {
      const r = json({ unknown: true }, 401);
      r.headers.set("Apollo-TF-Session-Profile", "renewal-v1");
      return r;
    });
    await expect(client.fetchTfSession()).rejects.toMatchObject({
      kind: "invalid",
      renewalProfile: undefined,
    });
  });
  it("strict protected503 suspends existing access immediately", async () => {
    client.commitTfSessionSecurityState(session());
    vi.stubGlobal("fetch", async () =>
      json({ code: "TF_RENEWAL_AUTHORITY_UNAVAILABLE", retryable: true }, 503),
    );
    await expect(client.tfFetch("/private")).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(client.canUseTfProtectedActivity()).toBe(false);
  });
  it("aborted context body cannot send renew", async () => {
    const abort = new AbortController();
    let resolve!: (body: unknown) => void;
    const fetch = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: new Headers({ "Content-Type": "application/json" }),
      text: () =>
        new Promise((r) => {
          resolve = (body) => r(JSON.stringify(body));
        }),
    }));
    vi.stubGlobal("fetch", fetch);
    const pending = client.renewTfSession(abort.signal).catch((e) => e);
    await Promise.resolve();
    await Promise.resolve();
    abort.abort();
    resolve({ csrf_token: "a".repeat(42) + "A" });
    await pending;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("generated API error retains the finite short-expired meaning", () => {
    client.commitTfSessionSecurityState(session());
    const events: client.TfAuthSecurityEvent[] = [];
    const unsubscribe = client.subscribeTfAuthSecurityEvents((event) =>
      events.push(event),
    );
    client.reportTfAuthError({
      status: 401,
      headers: new Headers(),
      data: { code: "TF_RENEWAL_ACCESS_EXPIRED", retryable: false },
    });
    unsubscribe();
    expect(events[0]?.type).toBe("expired");
  });
  it("duplicate context member is rejected instead of selecting the last token", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          '{"csrf_token":"' +
            "a".repeat(42) +
            'A","csrf_token":"' +
            "b".repeat(42) +
            'A"}',
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(client.renewTfSession()).rejects.toMatchObject({
      kind: "invalid",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
