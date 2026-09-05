import { randomBytes, randomUUID } from "node:crypto";
import type { FamilyPersistence } from "./tf-family-store.js";
import {
  renewalVersion,
  type FamilyBinding,
  type RenewalResult,
} from "./tf-renewal-contract.js";
export const testOpaque = () => randomBytes(32).toString("base64url");
export function memoryFamilyPersistence(
  now: () => number = Date.now,
): FamilyPersistence {
  const values = new Map<
    string,
    { raw: string; expiry: number; outbox: boolean }
  >();
  const rates = new Map<string, { until: number; count: number }>();
  return {
    async read(k) {
      const value = values.get(k);
      return value && value.expiry > now() ? value.raw : null;
    },
    async cas(k, expected, raw, expiry, extend, outbox, lineage) {
      const current = values.get(k);
      const actual = current && current.expiry > now() ? current.raw : null;
      if (actual !== expected || expiry <= now()) return false;
      if (lineage) {
        const currentLineage = values.get(lineage.key);
        const actualLineage =
          currentLineage && currentLineage.expiry > now()
            ? currentLineage.raw
            : null;
        if (actualLineage !== lineage.expected || lineage.expiry <= now())
          return false;
      }
      values.set(k, {
        raw,
        expiry:
          current && actual && !extend
            ? Math.min(current.expiry, expiry)
            : expiry,
        outbox: !!outbox,
      });
      if (lineage)
        values.set(lineage.key, {
          raw: lineage.value,
          expiry: lineage.expiry,
          outbox: false,
        });
      return true;
    },
    async pending() {
      return [...values]
        .filter(([, v]) => v.outbox && v.expiry > now())
        .map(([k]) => k)
        .slice(0, 10);
    },
    async allowContext(k) {
      let r = rates.get(k);
      if (!r || r.until <= now()) {
        r = { count: 0, until: now() + 60_000 };
        rates.set(k, r);
      }
      return ++r.count <= 10;
    },
  };
}
export const testBinding = (): FamilyBinding => ({
  ...renewalVersion,
  account_id: randomUUID(),
  session_id: randomUUID(),
  installation_id: randomUUID(),
  client_id: "apollo-tf-api",
  audience: "apollo-tf",
});
export function testRenewalResult(
  binding: FamilyBinding,
  now: number,
  previous?: RenewalResult,
): RenewalResult {
  const iat = Math.floor(now / 1000) * 1000;
  return {
    ...binding,
    family_id: previous?.family_id ?? randomUUID(),
    generation: previous ? previous.generation + 1 : 0,
    renewal_reference: testOpaque(),
    absolute_expires_at:
      previous?.absolute_expires_at ?? new Date(iat + 3600_000).toISOString(),
    issued_at: new Date(iat).toISOString(),
    access_expires_at: new Date(iat + 300_000).toISOString(),
    renew_after: new Date(iat + 240_000).toISOString(),
    token: {
      access_token: "source.test.assertion",
      token_type: "Bearer",
      expires_in: 300,
    },
  };
}
