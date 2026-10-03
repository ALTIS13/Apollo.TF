# Selected favorites removal

Status: SOURCE_AND_FIXTURE_BROWSER_PASS / SPEC_AND_QUALITY_APPROVED_SOURCE_ONLY / NOT_DEPLOYED.

## Change

Loaded selected favorites (up to 20) now have a Trash2 command and an explicit confirmation, with initial focus on Cancel. Existing account-scoped DELETEs run sequentially in collection order. Only current-session acknowledged removals count and leave selection; a failure stops further sends. Explicit retry uses the frozen unconfirmed remainder, not already acknowledged IDs. Favorites membership changes only; playlists and the device-local player queue do not change.

Stop/Escape/outside close during a send cancels subsequent sends, not the sent request. That current-scope request retains its lock until settlement; its cancelled response stays unconfirmed. Session/security loss and unmount cancel/release immediately. Same-owner renewal preserves a retry remainder but does not resume or confirm the obsolete operation. Exact session, collections entitlement, protected deadline and security generation guard both sides of each await. Operation identity prevents an old completion from unlocking a replacement run.

Parent synchronous locks cover selected queue commands, single removal, row/play-all commands, selection, batch addition, reorder, refresh and pagination. Removing the last loaded row still allows selection mode to close; focus returns to the selection toggle if the original trigger becomes disabled. This is not a transactional batch, rollback promise or new authentication/queue authority.

## Focused TDD

- First RED: missing accessible removal command, 1 failed / 30 skipped.
- Expanded RED before production edits: 14 failed / 30 skipped.
- First implementation check: 13 new passed, 1 failed because selection could not exit after the last row was removed. The empty-selection guard and focus fallback were corrected.
- Final affected-file run: `pnpm --filter @workspace/music-player exec vitest run src/components/LikedCollection.test.tsx --testTimeout=10000 --reporter=dot`, **44/44 PASS**, 51.66s. These are 14 new cases plus 30 existing cases, not cumulative run counts. Timeout is CLI-only, reusing the documented existing keyboard-test allowance.
- Music-player typecheck and `git diff --check`: PASS. Vite build: PASS in 11.91s; unchanged tooltip/sheet sourcemap warnings and >500kB bundle warning remain (JS669.98kB, gzip207.87kB).
- No backend suites, migrations, whole-workspace tests or duplicate reviewer runs were required: the existing idempotent, account-scoped DELETE contract is unchanged.

### R1 Review Correction

The first independent review found a successful security commit / stale React session interval. Two real-hook regressions (foreign account and same-account rotated session) both reproduced a DELETE from the old rendered selection before the fix: 2 failed /44 skipped,24.72s. Sampling a new generation alone was insufficient.

The existing internal `canUseTfProtectedActivity` now accepts an optional exact-session witness; removal passes its snapshot session, requiring reference equality with the session that established current security state. No-argument behavior, provider publication and wire/identity/policy contracts are unchanged. This also rejects a stale initial mount or intervening rerender, without trusting tuple-only equality.

After correction, affected-file **46/46 PASS**,22.29s (16 new cases +30 existing). Typecheck then found one unsupported `exact` test-locator option; it was removed without changing matching behavior. Final typecheck PASS and focused R1 **2 PASS /44 skipped**,3.18s. The unchanged46 cases were not rerun for that type-only edit. Final Vite build PASS4.39s, same warnings, JS670.02kB/gzip207.89kB. Delta-only independent R1 review: ADDRESSED, SPEC/QUALITY APPROVED_SOURCE_ONLY, no remaining findings; exact final blobs match below. No source/native acceptance is inferred from the original44 run.

## Rendered Evidence

Flow: `/favorites` -> select two loaded tracks -> open/cancel confirmation -> confirm -> hold first DELETE -> first acknowledgement and second failure -> retry only second -> retain the unselected third recording and unchanged local queue.

Browser control plugin is not callable in this session (`Browser plugin not available`), so the existing bundled Playwright used installed Chrome, headless, without altering the user's tabs/profile or installing tooling. Viewports1440x900,390x844,320x740, 20px default font and reduced motion. Desktop/320 exercise the full failure/retry flow;390 exercises confirmation/cancel and layout, not a duplicate full flow.

- Confirmation does not send DELETE; cancellation retains selection. During the held send, seven conflicting collection commands are disabled.
- Request sequence is exactly first/second/second: confirmed first is never replayed, unselected third remains, local PlayerProvider queue snapshot is byte-identical before/after, and existing CSRF header is sent.
- No horizontal document/dialog overflow, clipped dialog or Vite overlay. No unexpected API calls or application console/page errors. One deliberate503 fixture response per full-flow viewport is recorded separately, not hidden as a healthy request.
- Confirmation and retry screenshots were visually inspected. The narrow retry dialog remains within the viewport and scrollable height limit, with wrapped labels and actions.
- After R1, a tiny320px actual-provider positive guard smoke sent/acknowledged only the selected first DELETE, retained other rows and unchanged queue, with no errors or unexpected API calls. Output is `tf-bulk-removal-20261002-security-smoke-evidence.json`. Earlier visual/failure evidence is reused because render structure is unchanged; those flows were not rerun wholesale.

Artifacts, outside committed source: `C:/Users/maksi/.codex/visualizations/2026/06/23/019ef2c2-95cb-7d01-9951-aa0abfe25d37/tf-bulk-removal-20261002-{qa.cjs,evidence.json,confirm-1440.png,retry-320.png}` (other captured widths/states share that prefix).

Synthetic account/session/HTTP responses exercise actual auth/collection hooks and PlayerProvider. This is not real Auth, target PostgreSQL deletion, provider audio, physical phone or canary acceptance. The dev server remains `http://127.0.0.1:54196`, without a local API proxy; raw navigation alone is not an authenticated beta.

## Current Boundaries

New UI is outside frozen built source `f3828eb`. [Native admission delta](../operations/2026-10-02-tf-native-admission-delta.md) records absent old build images and the unresolved publisher/Platform inputs. No release claim, image push or HomeNode mutation accompanied this change.

If a current-scope transport never settles, Stop does not fabricate settlement: the lock remains until transport settles or session/security/unmount invalidation. A sent DELETE may commit after cancellation; the independent remainder permits explicit idempotent recheck. The existing mutation also awaits liked-query invalidation/refetch; that lifecycle is not refactored here.

Final source blobs: LikedCollection `f78acf36770906569b6f20a8a2f28d38464536ca`, test `ad53ad45c17f5b2d71030509fc3c898c84923c37`, LikedRemovalAction `117f6aeb173dcdf8a5031d5052a4c014eb252691`, tf-session-client `1aaaab129d3976667078bdc272f4c90b0ee0ef01`. Worker/review recovery: `.superpowers/sdd/bulk-removal-20261002`.
