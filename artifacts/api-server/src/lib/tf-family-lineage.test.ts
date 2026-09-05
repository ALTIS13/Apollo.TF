import { describe, expect, it } from "vitest";
import { TfFamilyStore } from "./tf-family-store.js";
import {
  memoryFamilyPersistence,
  testBinding,
  testOpaque,
  testRenewalResult,
} from "./tf-renewal-test-support.js";

describe("D05 atomic browser-lineage persistence", () => {
  describe("round 2 reservation CAS", () => {
    it.each([false, true])(
      "rejects changed active observation at the actual reservation CAS (existing active=%s)",
      async (withActive) => {
        const persistence = memoryFamilyPersistence();
        const store = new TfFamilyStore(persistence),
          binder = testOpaque();
        if (withActive) {
          const login = await store.createLogin(binder),
            binding = testBinding();
          await store.beginEnrollment(
            login.handle,
            binding,
            "initial.test.assertion",
          );
          await store.complete(
            login.handle,
            await store.claim(login.handle),
            testRenewalResult(binding, Date.now()),
          );
        }
        const beforeB = await store.activeForBrowser(binder);
        const b = await store.createLogin(binder, {
          revision: beforeB.revision,
          active: beforeB.active,
          authorized: true,
        });
        const binding = testBinding();
        await store.beginEnrollment(
          b.handle,
          binding,
          "initial.test.assertion",
        );
        const claimed = await store.claim(b.handle);
        const observed = await store.activeForBrowser(binder);
        const cas = persistence.cas;
        let raced = false;
        persistence.cas = async (...args) => {
          if (!raced && JSON.parse(args[2]).phase === "LOGIN") {
            raced = true;
            await store.complete(
              b.handle,
              claimed,
              testRenewalResult(binding, Date.now()),
              () => "encrypted-test-packet",
            );
          }
          return cas(...args);
        };
        await expect(
          store.createLogin(binder, {
            revision: observed.revision,
            active: observed.active,
            authorized: true,
          }),
        ).rejects.toMatchObject({ reason: "REFERENCE_SPENT" });
        expect((await store.activeForBrowser(binder)).active).toBe(b.handle);
        expect((await store.read(b.handle))?.record.phase).toBe("ACTIVE");
      },
    );
  });
  it("a concurrent replica cannot publish an older family after the lineage guard was read", async () => {
    const persistence = memoryFamilyPersistence();
    const a = new TfFamilyStore(persistence),
      b = new TfFamilyStore(persistence),
      binder = testOpaque();
    const loginA = await a.createLogin(binder),
      bindingA = testBinding();
    await a.beginEnrollment(loginA.handle, bindingA, "initial.test.assertion");
    const claimed = await a.claim(loginA.handle);
    const original = persistence.cas;
    let interleave = true;
    persistence.cas = async (...args) => {
      if (interleave && JSON.parse(args[2]).phase === "ACTIVE") {
        interleave = false;
        const loginB = await b.createLogin(binder),
          bindingB = testBinding();
        await b.beginEnrollment(
          loginB.handle,
          bindingB,
          "initial.test.assertion",
        );
        await b.complete(
          loginB.handle,
          await b.claim(loginB.handle),
          testRenewalResult(bindingB, Date.now()),
        );
      }
      return original(...args);
    };
    await expect(
      a.complete(
        loginA.handle,
        claimed,
        testRenewalResult(bindingA, Date.now()),
      ),
    ).rejects.toMatchObject({ reason: "REFERENCE_SPENT" });
    expect(await a.read(loginA.handle)).toBeNull();
  });
  it("logout invalidates every pending callback in the same browser, not another binder", async () => {
    const persistence = memoryFamilyPersistence(),
      store = new TfFamilyStore(persistence);
    const binder = testOpaque(),
      login = await store.createLogin(binder),
      binding = testBinding();
    await store.beginEnrollment(
      login.handle,
      binding,
      "initial.test.assertion",
    );
    await store.complete(
      login.handle,
      await store.claim(login.handle),
      testRenewalResult(binding, Date.now()),
    );
    const pending = await store.createLogin(binder),
      other = await store.createLogin(testOpaque());
    await store.close(login.handle, () => "test-encrypted-revoke");
    expect(await store.read(pending.handle)).toBeNull();
    expect((await store.read(other.handle))?.record.phase).toBe("LOGIN");
    await expect(
      store.beginEnrollment(pending.handle, binding, "initial.test.assertion"),
    ).rejects.toMatchObject({ status: 401 });
  });
});
