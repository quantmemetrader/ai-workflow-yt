# Design theory — Blend × Espresso

Both systems read from source, not memory:
`@juspay/blend-design-system@0.0.37` (`lib/tokens/*.ts`) and
`frappe-ui@0.1.278` (`tailwind/colors.json`, `tailwind/plugin.js`).

## Where they disagree

| | Frappe Espresso | Juspay Blend |
| --- | --- | --- |
| Neutral ramp | **warm** — `#F8F8F8 #EDEDED #E2E2E2 #999999 #525252 #171717` | **cool, blue-tinted** — `#F5F7FA #F2F4F8 #ECEFF3 #E1E4EA #CACFD8 #99A0AE #717784 #525866 #2B303B #181B25` |
| Steps | 10 | 14 (adds 25, 150, 950, 1000) |
| Primary | `#007BE0` | `#2B7FFF` (500) / `#0561E2` (600) |
| Body type | 13px @ **1.15**, tracking `.02em`, weight **420** | 14px @ **20px** (1.43), tracking 0 |
| Small type | 11px @ 1.15 | 12px @ 18px |
| Shadow | one hairline: `0 1px 2px rgba(0,0,0,.1)` | 7 steps from `0 1px 1px rgba(5,5,6,.04)` to `0 24px 48px 8px` |
| Focus | none defined | `0 0 0 3px #EFF6FF` — a soft tinted ring |
| Radius | 4 · 8 · 10 · 12 · 16 · 20 | 2 · 4 · 6 · 8 · 10 · 12 · 16 · 20 |

## What each is actually good at

**Espresso is a density system.** The 1.15 line-height and 420 weight let a
table hold eight columns without shouting. Its restraint — one accent, hairline
borders, no shadow vocabulary — is what stops a dense screen becoming noise.
Take from it: the ramp, the tracking, the hairline rules, the single accent.

**Blend is a state system.** Fourteen neutral steps exist so disabled, hover,
selected, and pressed are all expressible without inventing colours. The focus
ring and the seven-step shadow scale exist so depth and attention are ordered,
not ad hoc. Take from it: the focus ring, the elevation ordering, the extra
neutral steps for states, and — importantly — its *paragraph* line-heights for
anything longer than a label.

**The synthesis this project uses:** Espresso's palette and density for chrome
and tables; Blend's line-heights for prose, its focus ring for interactive
states, and its shadow ordering for layering.

## The "Database standard"

The Database desktop and phone screens are the quality bar. What makes them
work is not styling — it is **how much true information they carry**. Every
other screen is measured against this list:

1. **Real volume.** Six to ten rows, not three. A screen with three rows tells
   you nothing about how it behaves full.
2. **Every column that earns its place**, numerics right-aligned and tabular.
3. **Faces and thumbnails** wherever the row is about a person or a piece of
   media — recognition is faster than reading.
4. **Status as a semantic badge**, never bare text.
5. **A second surface** — a detail panel or the agent — so the screen answers
   the follow-up question without navigating away.
6. **A filter bar carrying real values**, not placeholder labels.
7. **A footer that states the count and the permission truth**
   ("18 files · filtered to what you can read").
8. **At least one non-happy state visible** — failed job, expiring consent,
   over-cap, audit pending. Screens that only show success are lies.

## Requirements that must stay visible

From `01_Build-Spec 2.pdf` — these are contract terms, not decoration:

- Agent output is filtered by the invoking employee's permissions (§2), and
  citations get the same check as content (§2.2.4).
- Nav shows only entitled modules (§4.1).
- Replies send only after human approval (§4.3); nothing publishes without an
  approval record (§4.6).
- Accounting is drafts-only (§4.7); projections are indicative (§4.8).
- Legal never returns a verdict, and its disclaimer is Clause 8.4.
- HR sits behind its own scope; no external sourcing (Schedule A3(8)).
- Caps stop consumption and notify (§4.11); keys are referenced, never shown (§8).
