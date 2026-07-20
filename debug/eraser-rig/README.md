# Eraser Torture-Test Rig

Written: 2026-07-19 20:40

A repeatable, parameterized harness that hammers the production partial/full
eraser against every seedable annotation type and checks **two truths after
every swipe** — the data the app persisted and the pixels it painted. Failures
are saved as replayable JSON cases so a fix can be re-verified by replay.

Single entry point: `agent-cli/eraser-torture-rig.mjs` (no `src/` changes; the
rig only reads app state through the existing `window.__diagState` diag harness
and the DOM).

## Run it

```bash
# from the worktree root, against a dev server that has dev auto-login
node agent-cli/eraser-torture-rig.mjs                        # known 7-bug set + K0 baseline
SEED='fuzz 10 1234' node agent-cli/eraser-torture-rig.mjs    # 10 random cases, rng seed 1234
SEED=debug/eraser-rig/<ts>/cases/<id>.replay.json \
  node agent-cli/eraser-torture-rig.mjs                      # replay one saved failure
```

| Env       | Meaning                                                                   | Default                 |
|-----------|---------------------------------------------------------------------------|-------------------------|
| `SEED`    | `known` \| `fuzz N [rngSeed]` \| path to a `.replay.json`                 | `known`                 |
| `MODE`    | `partial` \| `entire` (pre-seeded via the app's `eraserMode` localStorage) | `partial`               |
| `RADIUS`  | eraser size = **diameter in page units** (the toolbar Width number); page-space radius is half this | `20` |
| `PAGE_URL`| dev server                                                                 | `http://localhost:5230` |
| `OUT_DIR` | output root                                                                | `debug/eraser-rig/<timestamp>` |
| `KEEP=1`  | keep the throwaway document + storage object after the run                | off                     |
| `HEADFUL=1` | visible browser                                                          | off                     |

Each run: harvests the browser's dev auto-login session (Node-side password
login is captcha-blocked), creates a **throwaway 1-page document** (pdf-lib →
storage upload → `documents` row), seeds page 1 per case through
`openAnnotationDoc.applyByPage` (the real durable path), drives real
`page.mouse` gestures at 16 ms cadence on the eraser wrapper, and deletes the
document afterwards. Seeds are built with the app's own commit-JSON builders
(`annotationCreationCommit.js`, `textEditCommit.js`) so they are byte-identical
to app-drawn annotations.

## The two truths

**DATA truth**
- `D1 engine-consistency` — persisted page JSON must deep-equal what the shared
  engine (`src/utils/pageSpaceEraser.js erasePageAnnotations`) predicts for the
  same PRE state + **recorded** pointer trace + radius/mode with
  `canErase = allow-all` (product intent). The trace is recorded in-browser
  with the exact `pagePoint` math the app uses (same clientX floats, same
  wrapper rect, coalesced events, 0.2-unit dedupe) — reconstructing it from the
  intended mouse coordinates is not enough (CDP quantizes to device pixels and
  near-tangent sweeps flip boolean topology on that).
- `D2 semantic` — an independent, **correct-geometry** hit model owned by the
  rig (rotation about center, center-relative line endpoints, real image
  bounds) decides which objects the sweep must / must not have touched.
  Must-touch objects must be deleted-or-changed; must-not-touch objects must
  stay canonically byte-identical. This tier catches hit-test bugs living
  *inside* the shared engine, where D1 alone would agree with the app about the
  wrong answer. Borderline hits (±2.5 page units) are classified `ambiguous`
  and asserted on neither side.
- `D3 slivers` — changed ink survivors are scanned for degenerate geometry:
  ring area < 1.0, effective ribbon width `2A/P` < 0.32, or width < 1.0 with
  area < 40 (calibrated offline against the engine: edge-graze hairline →
  0.30/91; graze+cross crescent → 0.68/3.9; healthy stubs ≥ 1.0).
- `D4 durability` — a fresh cold Y.Doc load from the backend must match the
  in-app state **per id** (order-insensitive: Y.Map cold-read order can differ
  from in-app array order; verified content-identical and recorded
  informationally as `coldOrderMatchesInApp`).

**PIXEL truth** (screenshots of the page wrapper; regions are object bboxes)
- `P1 live-feedback` — objects the engine/case says were hit must visibly
  change in at least one mid-drag frame (carve or ghost), not only at release.
- `P2 post-stability` — frames at t+1.1 s and t+1.9 s after release must match
  (≤0.35% pixels): no lingering streaks that later clear, no oscillation.
- `P3 commit-repaint` — after release, data-changed regions must differ from
  BEFORE; untouched regions must match BEFORE (skipped when a data-changed
  neighbor's bbox overlaps the region, and for non-rendering types like
  stamps).
- `P4 composite-stability` — a control rect far from every swipe must stay
  stable in every mid-drag frame (transient blank / double-composite catcher).

The app's persistence-time transient-key strip
(`normalizeCanvasJsonForHistory`: `perPixelTargetFind`, `selectable`, …) is
mirrored before every data comparison so it never reads as a divergence.

## Output layout

```
debug/eraser-rig/<timestamp>/
  summary.json                 # per-case pass/fail, per-truth findings, bug map
  cases/<id>.replay.json       # every FAILING case: seeds + exact recorded traces
  shots/<id>-before|s1-mid1|after|stable.png
```

`summary.json` ends with `knownBugsReproduced`, `knownBugsMissed`, and the case
records list every finding as `{truth, check, id?, message}`.

## Known-bug case map (validation run 2026-07-20, all reproduced)

| Case | Bug | What it proves |
|------|-----|----------------|
| K0-baseline | — | sanity: partial ink erase works, neighbors untouched — must PASS or the rig itself is broken |
| K1-line-slash | #1 | "/" lines AND arrows fully immune (center-relative endpoints read corner-relative) |
| K2-line-backslash-far-half | #1 | "\" line: only the half nearest its top-left erases |
| K3-rotated-rect-text | #2 | 45° rect + 90° text hit regions rotate about the wrong pivot |
| K4-stamp-image | #3 | stamps (`type:'image'`) always immune (dead hit-test default) |
| K5-ink-slivers | #4 | edge graze → 0.3-wide hairline ribbon; graze+shallow-cross → crescent fragment; both persisted |
| K6-late-path-ghost | #6 | path-typed whole-delete crossed after carving starts: zero live feedback until release |
| K7-cancel-discards | #7 | pointercancel mid-gesture throws the whole erase away instead of committing |
| K8-space-unassigned-immune | #5 | with an active space, annotations with no space assignment are immune |

Bonus findings the validation + fuzz runs surfaced beyond the listed seven:
- **Degenerate zero-area rings**: fuzz (`fuzz 8 1234`, FZ06) persisted ink
  whose polygons contain 3-point rings where all points are the same
  coordinate — pure junk geometry from the boolean lane.
- **Runtime-divergent tangent booleans**: on K5's chained tangent grazes the
  browser commit and the Node oracle (same engine, same recorded trace,
  identical bounds) persist visibly different leftover area (288 vs 50 units²)
  — the polygon-subtraction lane is ulp-sensitive in the tangent regime. Shows
  up as K5's D1 finding.
- **Cold-read order differs from in-app order** (informational, not failed):
  content is identical per id but the backend cold read can return a different
  z-order than the in-app array.

## Adding cases

Known cases live in `knownCases()` inside the rig: an entry is

```js
{
  id: 'K9-my-case', bug: null /* or bug # for expected-fail */,
  note: 'one-liner shown in reports',
  objects: [CONTROL(), F.rect({...}), F.line({...}), straightInk(...)],
  swipes: [seg(x1, y1, x2, y2, steps)],   // page units, 612×792 page
  midAt: [0.5],                            // mid-drag capture fractions
  // optional: cancelAtFraction, cancelAtEnd, activateSpace: 'sp-rig',
  //           pixelSkipIds: ['id-of-non-rendering-object'],
  //           liveMustGhostIds: ['id-that-must-ghost-mid-drag'],
}
```

Factories: `F.rect/ellipse/line/ink/text/image/starPath` + `straightInk`; all
produce app-identical commit JSON. Keep everything at `y ≤ 560` (the undo toast
pops bottom-center) and away from the control rect at (40,40)-(110,85). A
failing case automatically writes `cases/<id>.replay.json`; verify a fix with
`SEED=<that file>`.

## Caveats

- The dev server must have dev auto-login (`VITE_DEV_AUTO_LOGIN_*` in
  `.env.local`); the rig signs its Node client in with the harvested browser
  session.
- Stamps don't render in the SVG layer or canvas painter, so K4 asserts data
  truth only (`pixelSkipIds`).
- Between cases the page is reseeded through the durable path and the rig
  waits for the app to hydrate (realtime); on a realtime hiccup it falls back
  to reloading the document.
- Callouts and counters are not seeded in v1 (callouts live in the
  dual-representation store and delete through a separate lane —
  `onEraseCallout`; counters renumber on save which would contaminate the
  untouched-byte-identity check). Extend `F` with a callout factory once the
  shared-store flip lands.
