# Apollo unified execution: TF owner

Coordinator index: `C:/Users/maksi/Desktop/Apollo.Platform/docs/operations/2026-09-05-unified-execution.md`.

## Stage 3 / D05: successor session-renewal contract

- D05 contract status: `COMPLETE`; contract activation: `ACCEPTED_FOR_SOURCE_IMPLEMENTATION` / `RUNTIME_GATED`.
- TF implementation status: `IN_PROGRESS` (Task 3 consumer source only; explicit coordinator assignment after Task 1 SQL acceptance).
- Input TF SHA: `59670ce6bcc43580ad00ab382b49f3f00d039b2e`, branch `codex/tf-product-finish`.
- Input Platform root SHA: `ef0d2de3b9357020e5eeaf419da113fbedb632ab`.
- Related unimported Platform candidate: `7c9e95a9c7f39e1f29f61511bb4d253d23c3b9ef`; source/repository acceptance is owned by the coordinator.
- Input authority: user-approved unified plan, spec section 6 / decision D05, coordinator task assigning the contract path to TF.
- Output TF source SHA: unchanged `59670ce6bcc43580ad00ab382b49f3f00d039b2e`.
- Reviewed input contract SHA-256: `2f11130281cc24c8facf826e809eaa89ac4d1ce192c944c3ae01deb6304dc08f`.
- Output contract SHA-256: `5b85af3a223b6307d7cba2e7cb9f1cafa176ef5bc9a2bed11aa559cf3e0f246a` (raw file bytes, not a Git commit). No commit/push in this slice.
- Owned outputs: this journal and `C:/Users/maksi/Desktop/Apollo.Platform/docs/contracts/apollo-platform/v1/TF_SESSION_RENEWAL.md`.
- Interface: accepted separate strict `apollo.tf.session-renewal.v1` extension: M2M enroll/renew/revoke plus family/JTI-bound read-only check, and browser-to-TF-BFF renewal context/trigger. This status update changes no wire. Frozen TF authorize/token/introspection/JWT bodies do not change.
- Evidence: read-only frozen consumer and approved design reconciliation; exact contract drafted and content hash captured; no tests run. Existing liked PG17 proof `3 passed / 0 skipped` remains valid for its store scope.
- Recheck conditions: changes to the proposed wire/binding/expiry/retry rules or the actual consumer/producer assumptions require only affected contract reconciliation. Unchanged collection SQL/store does not invalidate its proof.
- Next step: coordinator records the agreed final hash; Platform implements its accepted producer prerequisites after Task 1/2 gates. TF adapter starts only on the next assigned implementation slice against that producer contract. Runtime inputs remain in section 10.

### Producer agreement completed

- Coordinator reported producer agreement on frozen Platform `157c84b`: `accepted_for_source`, no wire conflicts requiring TF changes. This is not a new TF review or runtime acceptance.
- Only the contract header/activation status and this journal changed after the reviewed input hash; endpoint paths, nonce, cookies, DTOs, deadlines and semantics are unchanged.
- Producer-owned gaps: genuine common-BFF parent receipt/exclusive refresh vault; initial signed JTI-to-grant/parent mapping; family/JTI access store/check; policy revision/earliest capability expiry; multi-short-transaction vault-level fencing; independent retry AEAD/custody; strict raw JSON parsing.
- Runtime remains gated by Task 1 SQL 19+12 acceptance, provisioning/genuine Auth/key inputs and common BFF. No code, tests, commits or runtime operations were performed for this status update.

### Output decisions and review points

- Separate immutable account/sid/canonical installation/client/audience/family tuple; eight-hour cap anchored to genuine parent login and capped by verified upstream/Platform policy, not refreshed JWT iat or mere auth.sessions presence.
- Short TF assertions remain <=300 seconds and <=8192 ASCII bytes. Reference rotates by generation/CAS; exact successful retry recovers the encrypted original result for <=60 seconds, rechecking revoke/policy without extending time.
- Common BFF alone holds Supabase refresh custody. Cross-family single-flight uses the shared Auth-session credential vault; unknown refresh outcome requires reauthentication, not replay of a possibly spent token.
- Coordinator accepted the separate family/JTI check, unchanged strict V1, upstream-capped eight-hour deadline and uncertain-refresh fail-closed semantics. This is contract-direction acceptance, not implemented behavior, producer acceptance or permission to modify frozen TF now.
- External documentation consulted: `https://supabase.com/docs/guides/auth/sessions` for timebox/inactivity/revocation distinctions. Changelog Markdown fetch failed with unsupported content type; no version-specific Supabase API implementation was attempted.
- Actual missing inputs: approved wire; authoritative upstream settings/parent receipt and refresh custody; registered client/issuer/origins and SQL grants; encryption/cleanup/restore custody. The document contains concrete behavior rather than placeholder endpoints/DTOs.
- Concurrent Platform work was visible during handoff; no other owner's files were edited or reverted.

### Coordinator clarification: cookie lifetime vs short access

- Input contract hash: `de2ebcd067ee81d65ae47ae5a7026f5d36441669f42dd5c928244b8e9dee14d2`.
- Changed only contract section 8 and this journal. Dedicated successor family/CSRF cookies and Redis family record last no longer than the effective absolute family cap; they are non-authorizing renewal/logout context. Short expiry returns no active `/auth/me` or protected access, but does not destroy still-renewable context. Legacy TTLs remain unchanged.
- Concrete recovery after a missed five-minute window/page reload: exact-Origin JSON POST `/api/auth/renew-context` returns only the existing bound CSRF using family cookies; no lifetime/identity/grant side effect. Then POST `/api/auth/renew` uses that CSRF and family context. This is necessary because the web origin cannot read API-host cookies and expired `/auth/me` must not return an active snapshot.
- Terminal family/absolute expiry/logout clears both successor cookies and drops authorizing/reference material; local fencing prevents late resurrection. Remote revocation retry remains non-renewing.
- Evidence: manual section-level consistency/read-back and new file SHA-256 only; no tests or implementation. Recheck only if cookie/context lifecycle or producer wire changes. Closed store evidence remains unaffected.

## Evidence reuse / ownership

- TF code at the input SHA is preserved. No runtime, source implementation, test, migration, image, deployment, or agent work is part of this stage.
- Root owns publication, integration review, authority configuration, and live operations. Platform owns shared login, refresh custody, canonical identities, policy, and SQL implementation.
- The first shared acceptance remains real login -> liked A/B -> capability/session revoke, with full-track playback and approved renewal beyond the original short grant for useful beta. It is not another store suite.

## Task 3 consumer implementation checkpoint

- State: `IN_PROGRESS`.
- Diff baseline/input SHA: `59670ce6bcc43580ad00ab382b49f3f00d039b2e`.
- Wire: accepted D05 contract SHA-256 `5b85af3a223b6307d7cba2e7cb9f1cafa176ef5bc9a2bed11aa559cf3e0f246a` in Platform contract path above.
- New gate evidence (coordinator): Task 1 SQL 19 schema + 12 bridge passed, no fail/skip, receipt `88c50cbf`; Platform root `58960c2` includes provisioning `3b7cbb8` and email reader `7fbf007`. Task 2 SQL 22 and real Auth/checker/common BFF remain unaccepted.
- Scope: TF auth client/store/browser-session/auth routes and owning tests; no producer, SQL, signing, UI, parser, runtime or deployment changes.
- Next concrete step: inspect owning auth composition/tests, add failing focused successor family/short-expiry/wire tests, then implement opt-in consumer with strict binding, durable CAS/idempotency and non-authorizing family context.
- Proof invalidation: new renewal/auth mechanisms need source tests; unchanged liked SQL/store evidence `3/0` remains valid and will not be rerun. Consumer tests do not establish producer-to-consumer or real-account acceptance.
- Output SHA/commands/counts: pending coherent implementation commit and scoped source verification.

## Fresh bounded implementation resume (current authority)

- This is approved SOURCE IMPLEMENTATION, not the obsolete contract-only task. Resume brief: Platform `.superpowers/sdd/2026-09-05-apollo-unified-production-plan/task-3-tf-consumer-resume-brief.md`.
- Preserved all inherited dirty consumer files at HEAD `59670ce6bcc43580ad00ab382b49f3f00d039b2e`; accepted read-only D05 contract hash verified as `5b85af3a223b6307d7cba2e7cb9f1cafa176ef5bc9a2bed11aa559cf3e0f246a`.
- Actual next work is auth.ts and tf-policy.ts wiring, owning actual-route negatives, and source-only CAS/retry verification. Historical future-step/read-only prose above does not supersede this assignment.
- No runtime, remote Auth, SQL, Docker/WSL, publication, producer edits, UI work or subagents. Root owns integration/runtime. Existing client/store test reports are historical, not fresh evidence.

### Source candidate checkpoint (implementation, not historic architecture)

- Auth route composition now opts into the D05 consumer through `AuthRouteDependencies.renewal`; missing/disabled renewal never falls back for either successor cookie. Start/callback retain a persisted local login/enrollment operation, callback enrolls instead of V1 introspection, and failed enroll transport can be resolved through the same pending family context.
- Protected HTTP operations use family/JTI-bound check on every request, with short access expiry separate from non-authorizing family context. Actual liked routes are covered without touching their storage. Mutation Origin/double-submit is followed by Redis CSRF binding; context/bootstrap has exact-Origin JSON, fixed lifetime and rate limiting. Empty/query/duplicate/oversized/malformed inputs fail closed.
- Redis CAS uses durable records, fixed PXAT deadline, operation nonce/key/correlation, lease/owner fencing, three-attempt/60-second bounds and non-authorizing encrypted revoke-only outbox. Local logout/account replacement blocks late results; stale terminal checks cannot close a newer generation. Early repeated renew checks current access rather than rotating again.
- Wire source uses real frozen JWT schema and EdDSA/JWKS verification, rejects duplicate outer JSON and signed duplicate JWT claims, validates nonce/bindings/deadlines/response metadata, and denies legacy private-HTTP transport for D05. Runtime must supply registered HTTPS producer origin; the legacy bridge flag is not D05 authority.
- Latest intermediate evidence: 41/41 focused source tests plus TypeScript before final JWT/HTTPS refinements; subsequent wire-only refinement passed 17/17. Final exact gate/counts will be recorded below and in the coordinator report. One combined fork-pool run exited unexpectedly without assertion failure; bounded thread-pool verification completed, so the crashed run is not acceptance evidence.
- Current next step: final focused source verification, exact scoped local commit and coordinator report; do not return to the superseded read-only TF task after compaction.

### Explicit remaining integration and activation gates

- Coordinator keeps successor WebSocket issuance/upgrade outside this source slice. `src/routes/websocket-tickets.ts: sessionHandle(request)` chooses legacy `__Host-apollo_tf`, then calls `TfSessionStore.issueWebSocketTicket(sessionHandle: string): Promise<string>`. `src/lib/tf-session-store.ts: consumeWebSocketTicket(ticket: string): Promise<WebSocketTicket | null>` validates a legacy backing session. `src/ws.ts: validateBackingPolicy(ticket, dependencies)` uses `observeSession(ticket.sessionHandle)` and V1 `platform.introspect(...)`, including upgrade/revalidation. These need a separately approved family-bound successor integration. `routes/index.ts` now explicitly returns 503 for successor WS ticket requests, including mixed legacy/successor cookies, before legacy issuance.
- UI active/playback scheduling and shared single-flight bootstrap/renew remain a separate consumer-facing integration; no UI/player/parser changes were authorized here. Source auth does not establish usable beta.
- Production composition must explicitly instantiate/inject the consumer, provision private Redis ACL/transport/at-rest protection and a TF-only revoke-outbox encryption key, schedule the bounded revoke-only drain, and supply the registered HTTPS Platform client/origin. No startup/runtime flag or deployment was enabled in this slice.
- Platform/common BFF still own real identity/policy, original parent receipt and refresh custody, grant/JTI linkage, real durable repository/executor semantics, SQL/RLS/locking, response/vault encryption keys, timebox provenance and producer-to-consumer runtime acceptance. Controlled source transports/stores are not proof of Redis Lua execution, database transactions, real Auth refresh, or deployed A/B/playback/revocation flow.

### Final local source gate and handoff

- `pnpm --filter @workspace/api-server exec vitest run src/lib/platform-auth-client.renewal.test.ts src/lib/tf-family-store.test.ts src/routes/auth.renewal.test.ts --maxWorkers=1 --pool=threads`: **44 passed / 0 failed / 0 skipped**, 3 files, final source run 2026-09-05 21:04 MSK. Breakdown: wire/JWT 17, family persistence state 6, actual HTTP routes/consumer 21.
- `pnpm --filter @workspace/api-server exec tsc -p tsconfig.json --noEmit`: exit 0. `git diff --check`: exit 0. All owning TS source/tests formatted with existing Prettier; no dependency changes.
- TDD RED evidence covered missing auth routes/capability selection, login enrollment wiring, malformed/oversized body boundary, stale terminal check closing newer generation, duplicate renew rotation, mixed-cookie legacy WS ticket issuance, successor-CSRF-only legacy fallback, expired result persistence, denial-to-outage misclassification, missing response headers, HTTP credential downgrade, and signed duplicate/expired JWT handling. Existing partial work was preserved; new tests that exercised already-correct partial behavior were not claimed as newly reproduced bugs.
- This commit is a **source candidate for root freeze/review**, not a deployable/usable-beta declaration. It changes 14 owning TypeScript files plus this journal. Exact output SHA and inventory are in Platform `.superpowers/sdd/2026-09-05-apollo-unified-production-plan/task-3-tf-consumer-report.md` after local commit.
- No unchanged legacy/collection SQL suite, full monorepo suite, real Redis, DB, Auth/provider/network service, Docker/WSL, image build, push or deployment was run. The only HTTP connections in source tests are local loopback Express servers; Platform/JWKS responses are controlled in-memory transports with ephemeral real EdDSA keys.
- Root owns required frozen-patch review before integration; no additional subagents were created. The accepted Platform contract remains read-only and unchanged.

## Review correction round 1/5 — CURRENT IMPLEMENTATION CHECKPOINT

- Current task is the root-authorized cohesive F1-F3 fix atop `3e58a90dab9dbde7a3e6e200bc7cb826e8216f43`; the earlier source candidate is REQUEST_CHANGES, not accepted. Review SHA-256 `f93685449e43cc998ed6e95fe41b2a07af1743262e78b0b73fd44e85e8a79a44` was read fully and verified.
- Focused browser-jar RED reproduced late callback A replacing B/returning after B logout, pending enrollment leaving live legacy cookies, and unprotected GET start closing active family. Legacy-only control passed. Initial test import hook timed out (not behavioral evidence); the bounded 30-second import setup used by the existing route harness allowed the actual RED run.
- In-progress fix: independent opaque `__Host-apollo_tf_browser` Secure/HttpOnly/Lax binder indexes a non-authorizing shared pending/active lineage with revision; installation UUID is NOT a fence credential. Atomic Redis family+lineage CAS fences callback publication and logout. GET start only reserves pending context; active replacement requires exact Origin and current bound family CSRF. Pending successor publication retires legacy credentials/cookies; terminal clears cannot expose the old cookie pair.
- Seven initial review scenarios now pass. Additional binder-only/same-installation and in-flight enrollment CAS interleavings are next, followed by affected source checks only, TypeScript, diff and one correction commit/report. Do not resume old architecture prose or rerun the old 44/wire/SQL suite after compaction. No UI/WS/producer/runtime scope expansion or subagents.

### Round 1 correction candidate — ready for bounded re-review

- F1: the independent 32-byte browser binder (Secure, HttpOnly, Lax, Path=/, no Domain) is not an installation ID, Platform identity or authorization grant. Its hash selects the shared local lineage. LOGIN/enrollment reservation, claim, promotion and logout compare the lineage and family in one same-slot Redis CAS; pending and active references remain distinct. Each start changes only pending revision. Completed replacement changes active selection; logout invalidates all pending callbacks in that browser. Callback re-reads current selection before emitting any cookies, including error recovery, so a stale callback cannot publish or clear a newer login's cookies.
- F2: verified successor enrollment retires any supplied legacy session before pending/success cookies can be published. Successor terminal clears remove both family and legacy cookie pairs; successor logout fences the family first and attempts legacy retirement even when remote revoke fails. A legacy-retirement outage cannot prevent the local family tombstone. Genuinely legacy-only behavior is preserved.
- F3: navigation-style GET start neither closes nor remotely revokes active family. An active replacement requires exact configured Origin and matching current family cookie/CSRF/Redis binding; the server-only transaction records this permission. Binder alone and forged CSRF cannot authorize replacement. A foreign-Origin POST is rejected before missing-cookie handling can emit terminal cookie-clears.
- Focused final command after formatting: `pnpm --filter @workspace/api-server exec vitest run src/routes/auth.lineage.test.ts src/lib/tf-family-lineage.test.ts src/lib/tf-family-store.test.ts --maxWorkers=1 --pool=threads` -> **22 passed / 0 failed / 0 skipped**, 3 files, 2026-09-05 21:32 MSK. Breakdown: browser-jar/review regressions 14; cross-replica lineage/CAS 2; directly affected family-state regressions 6.
- Additionally, the one changed prior login regression was checked using `pnpm --filter @workspace/api-server exec vitest run src/routes/auth.renewal.test.ts -t 'starts a fresh persisted login' --maxWorkers=1 --pool=threads` -> **1 passed, 20 intentionally filtered/not executed**. This is not an all-44 rerun or an unfiltered acceptance claim. Wire/JWT and collection SQL suites were not repeated.
- `pnpm --filter @workspace/api-server exec tsc -p tsconfig.json --noEmit` and `git diff --check` exited 0. Initial review scenarios had 6 behavioral RED failures / 1 legacy-only pass; later binder-only, cookie-clear ordering and logout/retirement-order REDs were fixed and included above.
- Runtime remains gated. Redis Lua changes are source-verified through controlled atomic persistence doubles, not an executed real Redis/replica test. Pre-activation family rows from the rejected candidate lack the required browser-lineage binding and fail closed; do not retrofit/revive them from account/installation UUIDs. Production composition must use fresh genuine login and separately validate the new same-slot CAS behavior. The independent browser binder may outlive a family but never authorizes or slides its deadline.
- Current outcome: one correction source candidate atop `3e58a90`, requiring root frozen-patch re-review. Exact correction SHA/inventory are recorded in the coordinator report after commit. No Platform producer/contract, UI, WS, deployment, dependency or runtime changes; no subagents.
