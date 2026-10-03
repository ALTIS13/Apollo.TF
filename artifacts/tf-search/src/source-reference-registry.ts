import {
  canonicalSourceKey, SOURCE_REFERENCE_TTL_MS, type TfSourceReference,
} from "@workspace/tf-search-contract/source-reference";
import type { MediaComparisonAssessment } from "./media-completeness.js";

const MAX_ENTRIES = 4_096;
const PROVENANCE_PRIORITY = { catalog: 3, preview_catalog: 2, peer: 1 } as const;
interface Entry {
  readonly comparison: MediaComparisonAssessment;
  readonly observedAt: number;
  readonly expiresAt: number;
  readonly minDuration?: number;
  readonly maxDuration?: number;
}
type LookupResult = { readonly sourceKey: string } & (
  | { readonly status: "known"; readonly reference: TfSourceReference }
  | { readonly status: "unknown" | "ambiguous" }
);

export class SourceReferenceRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(options: { readonly now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    this.prune(this.now());
    return this.entries.size;
  }

  observe(sourceUrl: string, comparison: MediaComparisonAssessment): void {
    const key = canonicalSourceKey(sourceUrl);
    if (key === undefined) return;
    const now = this.now();
    this.prune(now);
    const previous = this.entries.get(key);
    let next: Entry = {
      comparison: comparison.status === "known" ? { ...comparison, reference: { ...comparison.reference } } : { ...comparison },
      observedAt: now, expiresAt: now + SOURCE_REFERENCE_TTL_MS,
      ...(comparison.status === "known" ? {
        minDuration: comparison.reference.expectedDurationSeconds,
        maxDuration: comparison.reference.expectedDurationSeconds,
      } : {}),
    };
    if (previous) {
      const current = previous.comparison;
      // Weak/unknown observations cannot erase known evidence or perpetuate ambiguity's TTL.
      if (current.status === "ambiguous" || comparison.status === "unknown") next = previous;
      else if (comparison.status === "ambiguous") next = { ...previous, comparison: { ...comparison } };
      else if (current.status === "known" && comparison.status === "known") {
        const minDuration = Math.min(previous.minDuration!, comparison.reference.expectedDurationSeconds);
        const maxDuration = Math.max(previous.maxDuration!, comparison.reference.expectedDurationSeconds);
        if (current.recordingKey !== comparison.recordingKey || maxDuration - minDuration > 2) {
          next = { ...previous, comparison: { status: "ambiguous" } };
        } else {
          if (PROVENANCE_PRIORITY[current.reference.provenance] > PROVENANCE_PRIORITY[comparison.reference.provenance]) next = previous;
          next = { ...next, minDuration, maxDuration };
        }
      }
    }
    this.entries.delete(key);
    while (this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, next);
  }

  lookup(sourceUrl: string): LookupResult | undefined {
    const sourceKey = canonicalSourceKey(sourceUrl);
    if (sourceKey === undefined) return undefined;
    const now = this.now();
    this.prune(now);
    const entry = this.entries.get(sourceKey);
    if (!entry) return { sourceKey, status: "unknown" };
    this.entries.delete(sourceKey);
    this.entries.set(sourceKey, entry);
    if (entry.comparison.status !== "known") return { sourceKey, status: entry.comparison.status };
    return { sourceKey, status: "known", reference: {
      ...entry.comparison.reference, observedAt: entry.observedAt, expiresAt: entry.expiresAt,
    } };
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
  }
}
