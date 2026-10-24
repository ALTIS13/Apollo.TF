# Source-bound duration admission

Owner: Apollo.TF. Base: `ebb4b7c`, `codex/tf-listener-experience`.
Approved continuation: private server reference binding after recording-aware search.

Status: all four tasks complete locally. Spec/quality APPROVED_SOURCE_ONLY; closed-response P2 fixed and reviewed, compiler/URI deltas checked. [Evidence and next boundary](2026-10-01-source-reference-admission.md). No deployment or frozen release update.

## Boundaries

- No public v1 result/job DTO additions, identity/policy changes, migrations, push or deployment.
- Existing validated principal and operation capability gates remain authoritative. Public recording metadata is shared comparison evidence, not an account/installation grant.
- Known server references override all browser duration hints. Ambiguous evidence cannot be made known by a hint. A genuine miss remains unknown; retain the legacy hint only as an additional untrusted quality guard for misses, not proof. An unavailable/malformed private lookup fails admission with `duration_unverified`/503 before cache, spawn or enqueue.
- Freeze the same selected source and trusted duration in the existing queue field. Trusted artist/title replace display input when known. Worker source and staged-file probes remain unchanged.
- First registry is process-local, bounded, five-minute TTL; restart, eviction, expiry and another replica yield an explicit unknown, not durable verification. Do not claim universal rejection of unknown old IDs or full-audio proof.

## Tasks

1. Archimedes: private additive contract subpath, canonical source identity, search-owned registry and signed HTTP lookup. Reuse recording grouping/assessment; retain comparison evidence for candidates including rejected previews. Track conflicting source/recording observations conservatively without unknown overwriting a live known reference. Registry capacity 4096, TTL 300000 ms, bounded LRU; reads do not extend TTL. Exact/free/discovery and cache behavior covered narrowly. Public search schemas remain byte-for-byte unchanged.
2. Fermat: add optional `sourceReference` gateway method for source-compatible injected search-only clients. Real HTTP client implements it through existing signed dispatch. Missing method must fail closed at media admission, not bypass. Validate request correlation, canonical source correlation and known reference freshness. Reuse timeout/body/redirect protections. Own client and its focused tests only.
3. Main: resolve by authenticated principal and exact decoded/fallback source before all three media routes and queue. Known references replace hints; ambiguous clears hints; miss may preserve the untrusted legacy guard. Queue stores reference metadata/duration without leaking private fields into strict jobs/results. Focused regressions cover omitted/small hints, cache-before-admission, unavailable lookup, selected fallback, no partial enqueue, principal scope and real short recordings.
4. Goodall: read-only queue/auth provenance audit, then source diff review against this plan; do not rerun valid unchanged evidence. Main runs affected integration/build/type checks and updates one resume record, evidence report and owned local commit.

## Private Interface

Package export `@workspace/tf-search-contract/source-reference`:

- `TF_SOURCE_REFERENCE_PATH = "/v1/source-reference"`.
- `canonicalSourceKey(sourceUrl: string): string | undefined`: allowed HTTPS provider URLs only, no credentials/non-default ports/fragments; known YouTube watch/shorts/embed/live and youtu.be URLs share video identity (including mobile/www hosts and tracking/query order); SoundCloud/Bandcamp track identity ignores tracking but preserves meaningful path case. Unsupported valid provider paths may use deterministic URL identity, never fetch arbitrary URLs. Reject ambiguous video IDs, not silently map to a different video.
- `TfSourceReferenceCommand` strict: `{ schemaVersion: 1, requestId: canonical UUID, accountId: canonical UUID, sourceUrl: allowed bounded HTTPS URL }`.
- `TfSourceReferenceResponse` strict: `{ schemaVersion: 1, requestId, sourceKey, status: "known" | "unknown" | "ambiguous", reference? }`.
- Only known carries `reference`: `{ artist (1..300), title (1..500), type: original/remix/live/cover, expectedDurationSeconds: integer 1..86400, provenance: "catalog" | "preview_catalog" | "peer", observedAt: integer epoch ms, expiresAt: integer epoch ms }`. Positive lifetime <=300000 ms. Schemas exported as `tfSourceReferenceCommandSchema`, `tfSourceReferenceResponseSchema`.
- Gateway optional signature: `sourceReference?(input: Omit<TfSourceReferenceCommand, "schemaVersion" | "requestId">): Promise<TfSourceReferenceResponse>`.
- Search service same optional method for existing test/injected services, runtime implementation mandatory; app returns 503 when absent. No caller-supplied recording metadata in lookup.

## Verification Policy

TDD on actual regressions, focused affected tests; reuse accepted matcher/worker/auth evidence where inputs are unchanged. Existing user agreements take precedence over skill defaults requiring full unrelated suites, fresh agents, sequential independent work or broad branch review. Reuse three agents with disjoint scopes and one integrated stage review. No paid UI plugin calls for this server-only slice.
