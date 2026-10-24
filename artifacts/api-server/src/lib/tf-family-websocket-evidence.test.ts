import { expect, it } from "vitest";
import { wsFamilyFixture } from "./tf-family-websocket-test-support.js";
import { familyBinding } from "./tf-renewal-contract.js";

it("returns verified JTI evidence only after the actual exact D05 check", async () => {
  const f = await wsFamilyFixture();
  const result = await f.platform.renewal.checkWithEvidence({
    ...familyBinding(f.result),
    family_id: f.result.family_id,
    generation: f.result.generation,
    access_assertion: f.result.token.access_token,
  });
  expect(result.assertionJti).toBe(f.jti);
  expect(result.decision.accountId).toBe(f.binding.account_id);
  expect(f.requests.at(-1)?.body).not.toHaveProperty("renewal_reference");
  f.fail({ code: "TF_RENEWAL_SESSION_REVOKED", status: 401, retryable: false });
  await expect(
    f.platform.renewal.checkWithEvidence({
      ...familyBinding(f.result),
      family_id: f.result.family_id,
      generation: 0,
      access_assertion: f.result.token.access_token,
    }),
  ).rejects.toMatchObject({ reason: "SESSION_REVOKED" });
});
it("aborting one held read-only check releases it without canceling another check", async () => {
  const f = await wsFamilyFixture();
  let release!: () => void;
  f.hold(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  const abort = new AbortController();
  const input = {
    ...familyBinding(f.result),
    family_id: f.result.family_id,
    generation: 0,
    access_assertion: f.result.token.access_token,
  };
  const pending = f.platform.renewal.checkWithEvidence(input, abort.signal);
  for (let n = 0; n < 30; n++) await new Promise((r) => setTimeout(r, 1));
  const observed = f.requests.at(-1)!;
  abort.abort();
  await expect(pending).rejects.toMatchObject({
    reason: "AUTHORITY_UNAVAILABLE",
  });
  expect(observed.signal?.aborted).toBe(true);
  f.hold(null);
  await expect(
    f.platform.renewal.checkWithEvidence(input),
  ).resolves.toHaveProperty("assertionJti", f.jti);
  release();
});
it("consumer exposes checked selected-family evidence and does not authorize a replaced handle", async () => {
  const f = await wsFamilyFixture();
  const evidence = await f.consumer.authorizeWebSocket(f.handle);
  expect(evidence.assertionJti).toBe(f.jti);
  expect(evidence.selection.record.result.family_id).toBe(f.result.family_id);
  expect(evidence.selection.key).toMatch(/^tf-auth:\{families\}:[a-f0-9]{64}$/);
  expect(JSON.parse(evidence.selection.lineageRaw).active).toBe(f.handle);
  await f.consumer.logout(f.handle);
  await expect(f.consumer.authorizeWebSocket(f.handle)).rejects.toMatchObject({
    terminal: true,
  });
});
