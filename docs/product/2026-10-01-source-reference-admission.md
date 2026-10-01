# Source-bound recording duration

Owner: Apollo.TF. Stage: complete locally, independently approved SOURCE_ONLY. This commit is the source checkpoint.
Base: `ebb4b7c`, branch `codex/tf-listener-experience`.
[Bounded plan](2026-10-01-source-reference-plan.md).

## Admission Boundary

- Search owns the recording comparison and a private source-key lookup; the browser cannot supply recording metadata to that lookup. The new operation is signed with the existing internal gateway, separately from strict public v1 search results.
- API resolves the exact validated media source using its authenticated principal account. Deezer fallback resolves the selected YouTube/SoundCloud source, not the original preview URL. Existing Platform identity, installation validation, CSRF and operation capability gates are unchanged.
- A known server comparison replaces missing, small or forged client duration values. A conflicting comparison stays ambiguous. A genuine miss may retain the old client number only as an untrusted quality guard, not as server evidence. Lookup outage/malformed response blocks media admission with sanitized `duration_unverified`/503 before cache, headers, process or any batch enqueue.
- Queue preflight freezes the same source, server recording metadata and numeric comparison in the existing strict v1 job. No private reference, key, provenance or expiry fields leak into jobs or public results. Existing worker source and staged-file checks consume that snapshot unchanged.

## Lifetime And Ownership Limits

The first reference registry is process-local, bounded to 4096 entries with a five-minute TTL. Reads/public cache hits cannot renew evidence. Restart, eviction, expiration or a different replica return unknown; this is not persistent verification. Catalog adapter caching can contribute its already documented metadata age. This stage does not universally deny old/unknown track IDs or prove all truncations: the existing >=90-second comparison/<=90-second preview heuristic is retained, and legitimate short recordings remain valid.

Public metadata may be shared between accounts, but is not permission to listen/download, an installation token, or a Platform entitlement. Queue trust depends on the authenticated API producer and Redis writer controls. The source audit found no consumer-side signature over jobs; the capacity ledger and file-retrieval HMAC are not such proof. Production ACLs were not inspected here. Direct API streaming/download has source checks, not the worker's final-file-before-commit guarantee.

## Evidence

- Main: final selected API cases **73 passed**, 51 skipped, zero failures. Includes **22** new admission/queue/principal/closed-response cases. Original 15 admission regressions were observed RED then GREEN; four real HTTP-disconnect cases reproduced post-close cache/spawn/enqueue work before the one-line guard fixed it. The signed local search -> HTTP gateway -> API -> strict v1 queue case is GREEN: probe fixture30 rejected despite browser hint1; queue snapshot contains server210 and matched artist/title.
- Search/contract: **112** unique focused cases passed: private contract45, registry7, service integration10, signed private handler7, affected completeness43. Query aliases and percent-encoded unreserved/path spellings share identity; reserved routing delimiters and meaningful path case remain distinct. Cache/TTL, ambiguous metadata, rejected candidates, short/version recordings and defensive copies covered. No provider fan-out from lookup.
- Gateway: **31** focused fixture cases passed; source/request correlation, freshness at response receipt, strict private DTO, bounded transport and malformed/unavailable responses. After canonicalization changed, only affected client11 plus signed local API chain1 were rechecked (12 GREEN), other unchanged cases reused.
- Build/type evidence: refreshed private contract declarations; API and search TypeScript GREEN. Initial unbuilt declaration diagnostic and later registry discriminator narrowing failure were corrected, not hidden. Final API ESM rebuild GREEN; production search ESM build/load startup case **1 GREEN** with invalid configuration and no live bootstrap. Total **217 unique focused cases**, not summing intermediate/repeated runs. No whole application or unchanged UI/worker/auth suites rerun.
- Queue/auth audit: existing live capability/principal mounting and numeric job carrier support this slice. No job schema or worker changes needed. No persisted source-reference registry existed to reuse in inspected source.
- Independent API review: spec PASS, one P2 for closed-response continuation found and corrected using RED4/GREEN4. Integrated private contract/search/gateway and final URI/compiler delta review: spec and quality **APPROVED_SOURCE_ONLY**, P2 **ADDRESSED**, no open actionable findings. Captured source/delta hashes and exact comparisons were checked; reviewer reused test evidence without rerunning it. Detailed scratch evidence is under `.superpowers/sdd/source-reference-20261001/`.

No push/deploy, provider audio, native device, live Platform, Coolify, Redis ACL or HomeNode acceptance from this stage. Existing Caddy/UFW/Remnawave and other containers were untouched. No paid UI plugin calls or MobileNext session were needed for this server-only work.

## Next

Resolve/revalidate recording evidence for cold/expired IDs without promoting browser hints to authority; persisted metadata or server-side re-observation must have explicit freshness/source semantics. Live acceptance still requires a current source-matched immutable TF release and proven Platform issuer/client plus isolated Coolify prestate/rollback. Previously accepted UI/matcher/lyrics/collection work is not a task to repeat. Source commits do not replace the frozen release candidate or publisher packet automatically.
