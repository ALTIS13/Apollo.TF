# Portal visual reference guardrail

This file records the accepted visual family for a future Apollo account
portal. It does not authorize `artifacts/portal-web`, React/CSS work, or a mass
UI refactor. The first representative portal page requires separate concept
approval and comparison against the current Apollo.Quasar and Apollo.AI
references.

## Source references

- Apollo.Quasar:
  `D:\CodexProjects\Apollo.Quasar\.worktrees\windows-app-readiness\apps\desktop\src\ui\design-system.css`,
  especially lines 836-1092, 891-893, 1097+, and 1128+ from the reviewed
  handoff.
- Apollo.AI: repository-relative
  `apps/web/src/features/chat/chat-workspace.css`, especially lines 28-29,
  together with its current token/primitives layer.
- Approved portal composition reference:
  `C:\Users\maksi\Desktop\Apollo.Safe\docs\design\apollo-portal-selected-v1.png`.

These are references to compare against, not stylesheets or class names to
copy across repositories.

## Shared family

- Graphite surface hierarchy with `#8b5cf6` as the primary violet family.
- Plus Jakarta Sans for UI and Outfit for headings/numbers; tabular numerals
  where values align.
- Compact, readable information hierarchy, thin edges, and product-appropriate
  radii rather than universal oversized pills/cards.
- Quiet static ambient violet/cool depth is allowed. Glass is allowed for
  panels, summaries, and cards where it conveys material hierarchy, not only
  for overlays; avoid noisy nested blur and preserve readable content opacity.
- Motion belongs to state/hierarchy changes. The current family includes
  approximately 130/240/420 ms tiers and must honor reduced-motion. Avoid
  decorative perpetual animation.
- Green/amber/red/blue status color is paired with text and/or an icon; color
  alone never carries meaning.
- Header/title keeps the approved `Apollo ... | current section` separator.

Admin surfaces may be denser. The account portal may be calmer, while using
the same semantic token family and preserving legitimate product differences.

## Live composition evidence (2026-09-04)

The current authenticated Apollo.AI overview and `/models` pages were compared
with the installed Apollo Quasar `Обзор сети` application. This is visual
reference evidence only; displayed counts/runtime indicators are not fixture
data and do not prove network/runtime health.

- Apollo.AI uses a narrow icon rail, quiet violet top light, concise page
  heading, compact inline status chips, wide functional panels, GPU/chart/model
  information density, and a catalogue built from wide search, compact filters,
  and a table rather than hero tiles.
- Quasar uses an icon-plus-label rail, visible `Quasar | Обзор` chrome, a
  separate workspace, one summary strip, one primary violet action panel, and
  calmer support/journal panels. Rounded surfaces, thin light edges, local
  shadows, and depth remain visible in the installed rendering.
- Product composition may differ: portal/AI rail width and runtime color
  categories need not copy Quasar mechanically. The separator belongs where
  the product chrome has that title model; it must not create duplicate chrome
  in an AI-style page header.

Before approving the first new representative portal page, compare it
side-by-side with these live references in normal, empty, error, and stale
states. Token similarity alone is not visual acceptance. Source fixes may be
newer than the installed Quasar build, so source and live evidence are both
inputs rather than interchangeable authorities.
