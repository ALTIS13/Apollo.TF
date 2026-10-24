# Favorites Batch Addition - 2026-10-02

Owner: Apollo.TF. Status: **SOURCE / FIXTURE-BROWSER PASS**; independent scoped
spec/quality review approved, R1 addressed, no remaining findings.
Scope: listener source and controlled browser fixtures, not live acceptance.

## Implemented

- Explicit favorites selection, keyboard-labelled checkboxes and a loaded-only
  limit of 20 full recording IDs. Pagination never selects new records;
  disappeared IDs are removed. Selection and manual ordering are exclusive.
- The existing playlist picker accepts a compatible batch input. Selected DTOs
  and the target are fixed at submission; existing account-scoped mutations run
  sequentially in displayed order. No new batch route or database migration.
- Results distinguish added, already present and unconfirmed. Confirmed records
  are deselected; the first failure stops the chain. Explicit retry sends only
  the uncertain remainder with its original metadata/target. A changed selected
  ID set starts a new operation rather than reusing an obsolete retry snapshot.
- Whole-chain pending state blocks duplicate starts and conflicting selection,
  reorder/removal/refresh actions. Session, account, installation, entitlement,
  security generation, close and unmount guards stop further requests and stale
  UI publication. A sent POST can still commit after close; no rollback promised.
- Normal play and single-track playlist creation remain. Existing graphite,
  violet saved-state and cyan playback styling/controls are reused. No new
  dependency, artwork generation or paid design-plugin call was needed.

## Validation

- Real component/auth-provider/mutation tests with controlled HTTP: initial
  selection RED, plus policy-revalidation and changed-selection regressions,
  followed by 18 focused passing cases across the changed collection test and
  existing picker compatibility test. Web TypeScript passed. No whole suite,
  database, provider or unchanged queue stage was replayed.
- Browser/CUA tools are absent in this session; existing bundled Playwright
  Chromium and the already-running worktree Vite server were reused. Flow:
  `/favorites` -> select two -> existing playlist -> partial error -> retry.
  Desktop 1440 x 900, mobile 390 x 844 and 320 x 740, all with 20px browser
  default text and reduced motion. Exact POST IDs: first, second, second; the
  confirmed first record and unselected third were not resent/sent.
- Page identity/content, no framework overlay, document/main/dialog horizontal
  bounds and screenshots passed. No unexpected console/page errors; the sole
  HTTP 500 per flow is the deliberate second-add failure. At narrow/enlarged
  text, the collection uses normal vertical scrolling; first viewport also
  captured separately, not inferred from a scrolled screenshot.
- Review R1 found inherited picker zoom/slide under reduced motion. Actual
  Chromium RED: `enter`, 0.2s. Local important animation/transition overrides
  give GREEN: animation `none`/0s, transition property `none`; normal motion
  remains `enter`/0.2s/property `all`. Shared primitives/auth were not changed.
- Final changed web bundle built with canary API origin and successor WS off.
  Exit 0; existing tooltip/sheet sourcemap-reporting diagnostics and >500kB
  bundle warning remain. They were neither hidden nor expanded into a refactor.

The first browser fixture omitted renewal-profile negotiation and triggered the
unchanged legacy WS-ticket path. Restoring the existing fixture header fixed the
harness; this was not a product/auth fix. The motion probe was corrected to
inspect disabled transition property rather than an irrelevant inherited duration.
Screenshots, runner and JSON are outside Git in this chat's visualizations folder,
prefix `tf-batch-20261002`; private interruption/review records are under
`.superpowers/sdd/collection-batch-20261002`.

## Limits And Next

This is not an atomic server batch, bulk deletion, provider import or a shared
queue/offline authority. A full unmount discards retry UI, not server changes;
an unresolved in-flight request retains busy locks until it settles. No live
Platform identity, database, audio, Coolify runtime or A063 test is claimed.
The [frozen built candidate](../operations/2026-10-02-tf-canary-release-candidate.md)
does not include this later UI source. Publisher/Platform admission is unchanged.

Next independent listener slice: play/add the selected favorites through the
existing device-local queue contract. Reuse its accepted playback/preflight
logic; do not rebuild playlist CRUD or repeat release preparation without new
publisher/Platform evidence. Bulk deletion/export remain separate open work.
