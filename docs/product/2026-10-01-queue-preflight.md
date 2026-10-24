# Bounded queue preflight

Source-only continuation from `77bd542`; complete and independently reviewed on
`codex/tf-listener-experience`. This commit is the local source checkpoint.
Requirements: [stage plan](2026-10-01-queue-preflight-plan.md).

## Behavior

The API validates the full batch of up to 50 track IDs and the capability needed
for Deezer-to-public-source fallback before any provider I/O. It then runs at most
four track checks concurrently per request. Search fallback and source-reference
lookup share a single 30-second batch deadline; a per-track completion does not
reset it. Results preserve request order despite out-of-order completion.

All source references must resolve before enqueue begins. Known server recording
and duration replace browser metadata/hints, ambiguous clears the hint, unknown
retains only the existing untrusted quality guard. Private gateway options are
local cancellation metadata, never serialized into v1 commands or jobs.

Deadline, HTTP close or a failed preflight aborts sibling waits and stops scheduling.
Late successes from dependencies ignoring cancellation cannot enqueue. Reference
failure/time-out uses 503 `duration_unverified`; fallback failure uses 503
`download_queue_unavailable`; invalid input/result remains 400 `bad_request` and
missing fallback capability remains 403 `module_access_denied`. Only the route
writer emits a response. No upstream details or abort reasons become public errors.

## Limits

Four is a per-request ceiling, not a distributed account/provider quota. Search
retains its existing global inspector/singleflight/provider bounds. Very cold
large batches can time out wholly; retry may reuse references warmed by completed
checks. This bounds preflight, not Redis enqueue after admission. Existing enqueue
results are not transactional, and disconnect does not undo jobs already created.
Canceling BFF transport does not prove cancellation of remote shared provider work.

No identity/session/policy/entitlement, public/private wire schema, worker, database,
lockfile, frozen release, HomeNode/Caddy/Coolify/UFW or unrelated service changes.
No actual audio/download/provider/authenticated deployment/native proof claimed.

## Evidence

Main: six intended RED regressions against sequential base, then six GREEN and
59 selected affected route cases GREEN. Real local HTTP/Express with controlled
provider/queue boundaries, including reversed completions and late ignored abort.
The deadline fixture invokes the production 30-second timer after I/O starts; it
does not wait 30 wall-clock seconds. Fermat: 14 intended RED then 14 GREEN cases
for both private operations, including pre-abort, body cancellation whose underlying
cancel never settles, late ignored success/rejection, listener/timer cleanup and
unchanged signatures. Two cases use native local HTTP with a held response body;
abort closes its server connection before the response ends.

Main: 52 existing affected HttpTfSearchClient cases GREEN (17 skipped, including
the 14 separately evidenced new cases and three unchanged configuration parser
cases), API TypeScript/build and compiled ESM syntax check GREEN. Total 125 unique
selected cases, not 125 new tests; unchanged project suites intentionally skipped.
Independent route and client/integration spec/quality review APPROVED_SOURCE_ONLY,
no findings. Exact frozen source hashes and commands in ignored stage reports.

Focused commands:

```powershell
pnpm --filter @workspace/api-server exec vitest run src/routes/tracks.test.ts -t 'bounded queue preflight|server source-reference admission|queue|enqueue|Deezer (download|fallback)' --maxWorkers=1
pnpm --filter @workspace/api-server exec vitest run src/lib/tf-search-client.test.ts -t 'private gateway cancellation' --reporter=dot
pnpm --filter @workspace/api-server exec vitest run src/lib/tf-search-client.test.ts -t 'HttpTfSearchClient' --maxWorkers=1
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
node --check artifacts/api-server/dist/index.mjs
git diff --check
```

Scope: four API source/test files plus plan/report/resume. No push, merge or deploy.
Next approved source task is touch-friendly full download/quality failure details
and source replacement: TrackCard currently truncates terminal status to 72px
and relies on hover title for details. Preserve its stable download controls and
reuse the existing search/library/source mechanics rather than rebuilding them.

Operational acceptance remains separate; [release readiness](../operations/2026-09-23-tf-listener-readiness.md)
and accepted [cold source revalidation](2026-10-01-cold-source-revalidation.md) are
unchanged evidence for their original inputs, not deployment permission.
