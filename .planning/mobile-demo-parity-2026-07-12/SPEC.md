# Mobile Viewer Demo-Parity Spec — the polish-pass master plan

Written: 2026-07-12 01:30

## What this is

The feature-by-feature plan for finishing the migration of the old polished mobile demo
(`mobile-expo-go/`, running on :8082 as "Survey Mobile UX") into the real app's mobile mode
(the web app served on :5177, wrapped by the `mobile-expo/` WebView shell on :8081 as "Survey").

Produced by a 7-agent investigation on 2026-07-12 (~1.2M tokens, every file on both sides read).
Evidence appendices in this directory:

| File | What it holds |
|---|---|
| `matrix.md` | **The backbone** — feature-by-feature parity matrix, 10 sections, every demo surface vs the new app, with file:line evidence on both sides |
| `audit-colors.md` | All 55 hard blue leftovers (exact file:line + what each should become) |
| `audit-layout.md` | 12 concrete layout/safe-area defects + 5 systemic problems (S1–S5) |
| `audit-survey.md` | Deep survey-mode comparison, control by control |
| `audit-history.md` | What the previous AI sessions did/claimed, where the design truth lives, 9 "smells" |
| `inv-demo.md` | Exhaustive inventory of the old demo (the layout/spacing/feature reference) |
| `inv-new.md` | Exhaustive inventory of the new mobile implementation |

## Ground rules (locked)

1. **Layout / spacing / features / feel reference = the OLD DEMO** (`mobile-expo-go/`).
   Confirmed by the 2026-07-10 session correction: copy its control order, dimensions,
   spacing, dynamic states, content-sized drawers — do not redesign.
2. **Color reference = the app's GOLD accent** (`--gold #d8a84e` per `docs/design/design.md`).
   The demo's blue `#4A90E2` family is NEVER the target — every "blue vs gold" row resolves to gold.
3. **New-app-only capability is protected.** The demo was a static prototype; the new app has real
   rendering, sync, search, presence, the whole home hub, etc. See "PROTECTED — do not destroy"
   at the end of `matrix.md`. Parity means matching look/feel, never deleting capability.
4. Existing enforced rules still bind: single-name fonts, zoomGeneration signal, container-aware
   canvas sizing, "Survey Marker" vocabulary, one shared color picker (CompactColorPicker),
   sentence-case UI copy.

## Current state (verified live in browser, 390x844, 2026-07-12)

- Mobile home (documents/projects/templates + bottom tabs) renders and is largely on-palette.
- Mobile viewer works: left tool rail, top bar, bottom dock, spaces sheet, survey sheet all exist.
- Seen live: blue active-tool highlight in the rail; document title overlapping the page pill;
  spaces sheet + exit button flush against the physical screen bottom (measured `padding-bottom: 0`,
  `--native-safe-area-bottom` unset in plain-browser context).

---

# THE WORK, IN PHASES

Ordered so the mechanical, high-confidence work lands first and the owner-decision work lands last.
Every item cites the appendix that holds its file:line evidence.

## Phase A — Gold re-skin of the mobile viewer (mechanical, do first)

The re-skin never happened inside `src/mobile/`: **3 gold occurrences vs 55 hard blue leftovers**,
all verbatim copies of the demo's blue palette. Full table with per-line targets: `audit-colors.md` §2–§3.

- [ ] Swap all 46 blue declarations in `src/mobile/mobilePdfViewer.css` (28 distinct UI elements —
      every `.is-active`/selected state: tool rail, page pill/menu, survey category/entity chips,
      keep-active toggle, format buttons, alignment picker, dock actives, page thumbnails,
      presence avatars, users sheet, template menu, survey `.btn-active`).
      Mapping: blue text/icon/border → gold accent; solid blue fills → gold + dark text `#17120a`;
      navy tint backgrounds → gold-tint dark (`#2a2218`); dark blue borders → `--gold-soft #b6904a`.
- [ ] Swap the 9 blue SVG fills in the text-alignment glyphs (`MobilePdfViewerChrome.jsx`).
- [ ] Recolor toggle-switch active tracks (`#28598D` demo-blue) in the mobile spaces rows.
- [ ] **Tokenize while there**: `src/mobile/` uses zero `var(--...)` today. Point everything at the
      hub tokens (`hub.css` / `docs/design/design.md` table). Note: `src/App.css` is dead-but-retinted —
      do NOT treat it as the live token source (`audit-history.md` smell #2).
- [ ] Audit the 3 stray light-bone text hexes + swatch shadow against the demo's no-shadow rule
      (`matrix.md` §10).

Acceptance: zero `#4a90e2`-family hexes left in `src/mobile/` + mobile-conditional chrome;
every active state in the viewer reads gold; `npm test` + build green.

## Phase B — Safe areas & sheet geometry (fixes "mis-sized / clipped corners")

Root causes measured and named in `audit-layout.md` (defects #1–#12, systemics S1–S5).

- [ ] **One inset owner** (S1): kill the `#root` env() bottom padding under the native shell and route
      every bottom consumer through `--mobile-bottom-inset`. Today iOS counts the bottom inset TWICE
      (everything floats too high) while raw `env()` consumers collapse to 0 on Android.
- [ ] **Bake bottom padding into the shared sheet class** (S3): `padding-bottom: calc(12px + inset)`
      on `.mobile-pdf-sheet` itself. Fixes in one shot: spaces exit button, survey exit button, and
      the pages action row all currently sitting inside the home-indicator zone (defects #1–#3 —
      this IS the "corners clipped" complaint).
- [ ] **Fix the spaces sheet height model** (defect #4, the "mis-sized" complaint): the height formula
      was copied from the demo, but the new sheet's real chrome is ~120px vs the 106px budgeted, and its
      rows are restyled desktop rows that don't measure 54/50px. Fix direction: measure content
      (scrollHeight) and clamp to the existing max, instead of predicting (S4).
- [ ] Bookmarks sheet floor: 238px minimum makes a 1-bookmark sheet huge; demo formula gives 126px (defect #5).
- [ ] Top inset consistency: viewer header uses raw `env()`; hub fixed header has no top-inset term (defect #7).
- [ ] Home screens in tabs mode: list bottom padding doesn't account for the fixed tab bar —
      last card hidden behind it (defect #9). Android: 4 raw `env()` spots in hub modals → 0 (defect #8).
- [ ] Landscape/notch-side insets: nothing anywhere handles left/right; shell injects bottom only (S2, defect #10).
      Decide scope: portrait-only for now is acceptable if documented.
- [ ] Sheet grab handle: 42x4 on survey/format sheets per demo (new is 34x4 everywhere); demo's spaces
      drawer has NO handle row — reclaiming those 18px also helps defect #4 (defect #12).

Acceptance: on a real phone, no control sits under the home indicator or the rounded corners;
spaces sheet hugs its content exactly; iOS and Android agree on spacing.

## Phase C — Survey mode, the real UX gap (biggest single chunk)

`audit-survey.md` + `matrix.md` §5. The demo's survey flow is sheet-native; the new app still
routes key moments through DESKTOP modals. Two decisions here are owner-level (see NEEDS-OWNER).

- [ ] **Marker detail sheet (the #1 gap)**: demo places a pin and immediately opens a 314px bottom
      sheet (category dropdown, entity swatch, rename, sibling-marker nav, locate, notes, checklist).
      New app instead pops desktop 500px centered blur-modals ("Categorize highlight", entity picker,
      name prompt) and the survey sheet stays collapsed. Build the mobile marker-detail sheet; the
      logic already exists scattered in the rail's expanded rows — re-house it, don't rebuild it.
- [ ] Notes editor: demo is an in-sheet takeover with photo/video pickers; new is a 600px desktop modal.
- [ ] Survey sheet internals to demo metrics: category cards back to radius 8 / 38px rows / big chevrons
      (currently desktop 24px rows), template picker rows to 42px with pressed states (currently
      hover-only — dead on touch), strip desktop admin chrome (drag handles, copy-mode toolbars,
      archived-checklist admin) out of the 392px sheet.
- [ ] Tap placed marker → its sheet must reliably open (today the expand effect only fires on a
      state *transition* and the sheet can stay hidden — `matrix.md` §5 "broken-ish" row).
- [ ] "Keep active" off → revert to pan after placement, like the demo (today the tool stays armed
      and the next tap raises the modal again).
- [ ] Full-page region confirm: inline toolbar confirm (demo) instead of `window.confirm()` browser dialog.
- [ ] Vocabulary: "Categorize highlight" → Survey Marker wording (hard product rule).
- [ ] Survey export (Export Excel / Sync M365): currently gated off mobile and its CSS is a dead stub —
      finish the port (`matrix.md` §5).

Acceptance: place-a-marker → detail-sheet → checklist → notes loop happens entirely in bottom
sheets with demo geometry; no desktop modal ever appears inside mobile survey mode.

## Phase D — Sheets & panels still wearing desktop clothes

`matrix.md` §3, §4, §8. Pattern: the sheet exists at the right height, but desktop markup renders raw inside.

- [ ] Bookmarks: demo mobile rows (38px, indent, icon bubbles, move up/down, jump-to-marker) — new
      passes no mobile props at all.
- [ ] Spaces rows: verify/apply demo touch metrics (54px space rows, 50px region rows, 40x24 toggle,
      28x16 mini-toggle, 38px region-row min-height); page-assign input is 28px — below touch minimum.
- [ ] Spaces header: confirm + (create) and export controls surface on mobile (`matrix.md` §4 partial).
- [ ] Version history: real data is there, but rows are desktop-styled; demo spec is 50px rows,
      radius 8, green 9px dot.
- [ ] Page thumbnail cards: confirm clipboard (copy/cut) badge surfaces on mobile cards.
- [ ] Context menus: only the pages menu exists. Port the demo's mobile menu chrome (154/176/188px,
      34px actions) and add the missing long-press menus — annotation (320ms), canvas paste (360ms),
      region delete (420ms) (`matrix.md` §7).

## Phase E — Formatting-bar gaps & smaller feature deltas

`matrix.md` §6, §9.

- [ ] **Edit panel for non-text tools**: demo opens the full edit sheet (color card, stroke split card,
      arrowhead) for pen/shapes/counter/eraser; new has it only for text/callout.
- [ ] **Color picker**: replace the native OS `<input type=color>` with the app picker
      (one-shared-picker rule; also restores presets + hex + opacity). Demo reference: in-panel
      gradient/HSV takeover with opacity slider.
- [ ] **Opacity control**: CSS exists, no JSX renders it — finish the stub.
- [ ] Preset color row (9 colors, 30px cells) for shapes/pen, not just text.
- [ ] Fit Height zoom option (demo has Fit Page / Width / Height; new lacks Height).
- [ ] Title marquee reveal for long titles (>18 chars) — today they just ellipsize; ALSO fix the
      title-pill overlapping the page pill (seen live at 390px).
- [ ] Styled dropdowns vs native `<select>` (module picker, eraser mode, line style, arrowhead):
      demo used styled menus everywhere — recommend converging, but see NEEDS-OWNER #3.

## Phase F — Motion & feel (single biggest cross-cutting "feel" delta)

`matrix.md` §10, `inv-demo.md` §17.

- [ ] Sheet exit animation: today sheets vanish (display:none) — demo slides out 170ms.
- [ ] Drag-to-dismiss physics: finger-follow + velocity threshold (dy>82 or vy>0.65) + spring-back;
      new is a flat 48px touchend delta.
- [ ] Zoom dropdown open/close animation parity (150ms in / 130ms out, fade+translate+scale).
- [ ] Panel-swap animation (demo LayoutAnimation 170ms) when switching between sheets.

## NEEDS-OWNER — decisions before the relevant phase starts

1. **Survey marker placement model** (blocks part of Phase C): demo = TAP places a numbered pin
   (entity-colored 26px circle). New app = DRAG-draws a rectangle highlight (matches desktop).
   Pick: pin-tap parity on mobile, keep rectangle, or both (e.g. tap=pin, drag=rect).
2. **Page pill interaction** (Phase E): demo = tap pill → type page number inline in the pill.
   New = tap → combined page/zoom menu with prev/next (a genuine superset). Keep menu, or restore
   inline input, or both.
3. **Native selects**: keep OS-native dropdowns (accessible, zero maintenance) or match demo's styled
   menus (visual parity). Recommendation: styled, to match everything else — but it's cosmetic-effort trade-off.
4. **Rail-nav zombie** (`audit-history.md` smell #6): the `?mobileNav=rail` hamburger mode was declared
   "discarded exploration" on 2026-07-08 but is back in the uncommitted diff as the web default.
   Keep it or delete it.
5. **Landscape support scope** (Phase B): nothing handles left/right notch insets. OK to declare
   portrait-only for now?

## Under-the-hood findings the owner should know (from `audit-history.md`)

- **Everything since Jul 8 is UNCOMMITTED on main** — ~4.5k lines across 23 files + all of
  `src/mobile/`, the new native shell, and the tests. One bad `git checkout` loses the migration.
  → Recommend committing the current state before the polish pass starts.
- A previous agent **falsely declared viewer parity** (2026-07-10 correction on record); the
  parity comparison servers were set up on 2026-07-11 but the comparison itself was never finished —
  this spec is that unfinished comparison, now done.
- "Sign out" → "Sign Out" in the uncommitted diff reverses the committed sentence-case decision — revert.
- Sync-status colors in the mobile model diverge slightly from the design-doc palette (minor).
- The Expo shell hardcodes a personal Tailscale dev URL — fine as dev harness, not shippable.
- `PLAN-GOAL2-palette.md`'s token-layer plan was superseded by the direct-retint commits but never
  marked so; its review log is an empty stub. Don't follow it blindly.

## How to verify any slice

Side-by-side on the phone: old demo = Expo Go :8082, new app = Expo Go :8081 (WebView → :5177).
On the desk: `http://localhost:5177/?mobileNav=tabs&nativeShell=expo` at 390x844 in a browser.
Remember `--native-safe-area-bottom` only exists inside the shell — test bottom-inset work on the
real phone or inject the var manually. Playwright cannot drive the real pinch-zoom path (known limitation).
