# Cold source-reference revalidation

Owner: Apollo.TF. Base: `33f3f89`, `codex/tf-listener-experience`.
Accepted continuation: restore server-owned duration comparison for saved sources after restart, expiry or eviction. No deployment or ownership refactor.

## Global Constraints

- Keep public/private v1 DTOs, Platform identity/policy/capabilities and strict download jobs unchanged.
- Inspect only the selected canonical HTTPS source. Never trust caller artist/title/duration, select another recording, or treat one source's own duration as independent full-recording evidence.
- Cold known evidence requires a fresh catalog fetch and the existing conservative artist/title/type/version match. Conflicting catalog lengths remain ambiguous; unsupported/unmatched metadata stays unknown. Fetch/process/validation failures fail closed through the existing sanitized 503 path.
- Existing explicit preview/title markers also fail closed for cold saved sources; they cannot become unknown successful admission. Ordinary short recordings are not rejected solely for their duration. No new v1 error DTO is introduced: this path currently reports duration_unverified, not a preview-specific 422.
- Warm known/ambiguous observations retain their existing five-minute expiry without new work. Unknown cold outcomes have a bounded 15-second cooldown, failures a bounded two-second cooldown; retry after cooldown is allowed.
- Cold requests coalesce by canonical source, at most eight active keys, with an 18-second service deadline. Inspection is at most eight seconds, catalog at most eight seconds; private gateway source-reference deadline is 20 seconds by default, independently bounded to 30 seconds. Existing search deadlines remain unchanged.
- No HomeNode, Coolify, Caddy, firewall, DB migration, publication, paid design plugin or device changes. Source/local HTTP evidence is not live provider/audio/auth proof.
- Use TDD and focused affected checks; preserve accepted evidence, avoid duplicate suites and unrelated edits.
- Optional upstream metadata JSON null values mean absence, not malformed metadata: pinned yt-dlp preserves Python None in JSON. Required source URL/type, malformed non-null values and explicit live/playlist indicators remain strict. Missing duration remains 0, not full-recording evidence.

## Tasks

1. **Source inspector (Archimedes):** new `artifacts/tf-search/src/source-metadata.ts` and focused tests only. Export `inspectSourceMetadata(sourceUrl, options?: { signal?: AbortSignal }): Promise<InternalTrack | undefined>`. Reuse child environment allowlist, classify and canonical keys. Direct track-only YouTube/public SoundCloud/Bandcamp, simulated yt-dlp, safe arguments, bounded output/deadline, correlation, sanitized errors. Unsupported paths/Deezer return undefined without spawning. Preserve full source title/version; prefer structured artist, otherwise uploader; do not parse an unrelated channel's headline into artist authority.
2. **Fresh catalog/deadline (Fermat):** Deezer adapter and tests, API signed search client and tests only. Add optional `{ fresh?: boolean; signal?: AbortSignal }` to catalog lookup. Fresh bypasses successful cached entries, can join current network work; failure never returns stale data. Honor abort and existing limits. Add optional `sourceReferenceTimeoutMs` client config, default 20,000 and validated existing 30,000 cap, applied only to source-reference. Existing search config output/deadlines remain compatible.
3. **Revalidation integration (main):** `search-service.ts`, new cold integration tests, runtime provider/index wiring and tests, one existing signed local API-chain test update. Add optional source metadata dependency, coalescing/deadline/cooldown and fresh matching. Preserve source correlation and warm registry semantics. Reuse admission/probes/strict jobs; do not change routes or worker. Record evidence, focused source review, owned local commit and short resume.

## Acceptance

- Fresh cold/expired references recover the same catalog duration, while legitimate short recordings and explicit versions remain distinct.
- A 30-second selected source compared with a 210-second same recording reaches the existing API rejection even without preceding search. Browser hints cannot override it.
- Wrong source, malformed observation, extraction/catalog failure, timeout and capacity return sanitized unavailability; late work cannot repopulate authority after deadline.
- Coalesced success gives each caller its own request correlation. No fan-out on warm evidence, no self-duration peer promotion, no failed-fetch stale fallback.
- Inspector process tests use simulated child output; signed local HTTP harness uses controlled metadata/catalog/probe/queue seams. No live readiness claim.

## Progress

- Task 1: complete, 42 uniquely evidenced inspector cases; final fix verified ten affected cases and reused 32 unchanged cases.
- Task 2: complete, 19 catalog and 45 private gateway selected cases GREEN; no stale fresh fallback or shared-caller abort propagation.
- Task 3: complete, 40 search boundaries and two signed local API cases GREEN; API/search TypeScript and ESM/compiled load GREEN. Independent spec/quality review APPROVED_SOURCE_ONLY after one P2 marker bypass was addressed. No push/deploy; this commit is the source checkpoint.
