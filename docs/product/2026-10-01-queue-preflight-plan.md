# Bounded download queue preflight

Approved continuation of the next source task in tf-listener-resume.md, base `77bd542`.
Owner: Apollo.TF. No Platform/identity/policy, worker, public DTO, runtime activation,
infrastructure, paid plugin, push or frozen release changes.

## Acceptance

- Decode every track and check Deezer fallback capability before provider I/O.
- At most four track preflights per request, in input order in the final result.
- One 30-second preflight deadline for the entire batch, including fallback search.
- All source references resolve before any enqueue; known recording/duration wins,
  ambiguous clears hints, unknown retains only the existing untrusted quality hint.
- Deadline, client close or one failed preflight cancels pending private HTTP waits,
  stops new work and prevents late enqueue even with an abort-ignoring dependency.
- Existing errors: invalid input 400 bad_request, missing fallback capability 403
  module_access_denied, fallback failure 503 download_queue_unavailable, reference
  failure or whole-batch timeout 503 duration_unverified. One response writer.
- Queue enqueue is not a transaction; existing per-track enqueue outcomes remain.
  Cancellation after enqueue starts does not roll back already admitted jobs.

## Tasks

1. Fermat: additive optional `{ signal?: AbortSignal }` on private gateway search
   and sourceReference; abort fetch/body wait, preserve strict signing/correlation,
   default per-operation deadlines and sanitization. Own only tf-search-client.ts
   and tf-search-client.test.ts. RED/GREEN focused cancellation cases.
2. Main: route-specific four-worker batch preflight, deadline and response-close
   lifecycle; focused real HTTP regressions for scheduling, all-before-enqueue,
   cancellation, deadline, prevalidation and ordering. Own tracks.ts/tracks.test.ts.
3. Goodall: independent review of only this stage's immutable patch; no edits or
   duplicate suites. Main closes affected TypeScript/build and records evidence.

## Workflow

Reuse agents with disjoint writes and no recursive delegation. Adapt skill defaults
to the user's explicit focused testing, existing agent reuse and current source
scope: no entire unchanged suite/branch review, model override or workspace deletion.
Keep chronological evidence in the stage report, one short current resume record.

## Status

- Task 1: complete, 14 cancellation cases RED -> GREEN, frozen client reviewed.
- Task 2: complete, six batch cases RED -> GREEN, 59 affected route cases GREEN.
- Task 3: complete, Goodall spec/quality APPROVED_SOURCE_ONLY for route and client
  integration, no findings. 52 existing affected client cases GREEN, API TypeScript,
  build and compiled ESM syntax GREEN. No unchanged full project suites.

Evidence: [stage report](2026-10-01-queue-preflight.md). Current checkpoint:
[listener resume](tf-listener-resume.md). Source-only local commit, no push/deploy.
