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

- [x] Swap all 46 blue declarations in `src/mobile/mobilePdfViewer.css` — DONE 2026-07-12,
      commit 19b31a2d. Adversarial review PASS; build + 1991-test suite green; browser-verified.
- [x] Swap the 9 blue SVG fills in the text-alignment glyphs — DONE, same commit.
- [x] Toggle-switch track `#28598D` — RESOLVED: value no longer exists anywhere in src/
      (already remediated by the earlier desktop retint); nothing to do.
- [ ] **Full tokenization** (remaining, downgraded to nice-to-have): blue swaps now use
      `var(--accent-primary, ...)` / literal-fallback forms, but the rest of `src/mobile/` neutrals
      are still hardcoded. Note: `--gold-soft`/`--gold-bg` are scoped to `.survey-hub` and do NOT
      resolve in the viewer — the literal fallbacks carry the value there. `src/App.css` is
      dead-but-retinted — NOT the live token source (`audit-history.md` smell #2); `--accent-primary`
      does ship via the built bundle.
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
- [x] Bookmarks sheet floor: 238px minimum makes a 1-bookmark sheet huge; demo formula gives 126px (defect #5).
- [x] Top inset consistency: viewer header uses raw `env()`; hub fixed header has no top-inset term (defect #7).
- [x] Home screens in tabs mode: list bottom padding doesn't account for the fixed tab bar (defect #9 —
      turned out to be NOT-a-bug: `.survey-hub .main` already owns tab-bar clearance; builder's double-pad
      was caught by review and reverted to the demo's 14px). Android: 4 raw `env()` spots fixed (defect #8).
- [x] Landscape/notch-side insets: OWNER DECISION 5 = portrait-only, orientation LOCKED. S2 injects all four
      insets for corner-curve awareness; landscape layout (defect #10) intentionally skipped.
- [x] Sheet grab handle: 42x4 on survey/text-defaults sheets. Spaces sheet KEEPS its handle (deliberate
      deviation — carries swipe-dismiss; content-measured height absorbs it) (defect #12).

**Phase B DONE 2026-07-12, commit acfd143c.** Adversarial review found 1 defect (defect-#9 double-pad) →
fixed inline. Build + 1955 tests green; browser-verified at 390x844 with simulated 34px inset.
Real-device iPhone 17 Pro Max acceptance still pending (Expo feeds were down).

Acceptance: on a real phone, no control sits under the home indicator or the rounded corners;
spaces sheet hugs its content exactly; iOS and Android agree on spacing.

## Phase C — Survey mode, the real UX gap (biggest single chunk)

`audit-survey.md` + `matrix.md` §5. The demo's survey flow is sheet-native; the new app still
routes key moments through DESKTOP modals. Two decisions here are owner-level (see NEEDS-OWNER).

- [x] **Marker detail sheet (the #1 gap)**: built inside the mobile survey sheet, derived from
      `expandedSurveyMarkers`; logic re-housed from the rail's expanded rows and the DESKTOP rows now
      delegate to the same shared helpers (identical store writes). Desktop centered modals suppressed on mobile.
- [x] Notes editor: in-sheet takeover on mobile with photo/video pickers; desktop 600px modal kept for desktop.
- [x] Survey sheet internals to demo metrics: category cards radius 8 / 38px rows / 36x38 chevron;
      template rows 42px + pressed state; desktop admin chrome (drag handles, copy toolbars,
      archived-checklist) mobileMode-guarded off.
- [x] Tap placed marker → detail reliably opens (fixed the transition-only expand bug).
- [x] "Keep active" off → tool reverts to pan after placement (demo App.tsx:1156).
- [x] Full-page region confirm: inline strip step on mobile; `window.confirm()` kept on desktop.
- [x] Vocabulary: "Categorize highlight" → "Categorize Survey Marker" + mobile-path sweep.
- [x] Survey export (Export Excel / Sync M365): un-gated on mobile, dead CSS stub finished, desktop handlers wired.
- [~] DEFERRED (need a sanctioned "move marker" mutation): category re-assign dropdown + module-navigator
      re-home. Both surfaced read-only; flagged in code. Not blocking.

**Phase C DONE 2026-07-12, commit a3740f27.** Placement stays drag-rect (owner decision 1). Adversarial
review PASS; 2 mobile-only defects it found (module-flip breaking rename's item link; locate opening the
desktop entity modal) fixed inline. Build + 1955 tests green; survey sheet browser-verified at 390x844
(gold chips, "Survey Marker" copy, entity swatches). Real-device acceptance pending.

Acceptance: place-a-marker → detail-sheet → checklist → notes loop happens entirely in bottom
sheets with demo geometry; no desktop modal ever appears inside mobile survey mode.

## Phase D — Sheets & panels still wearing desktop clothes

`matrix.md` §3, §4, §8. Pattern: the sheet exists at the right height, but desktop markup renders raw inside.

- [x] Bookmarks: demo mobile rows (38px, indent, icon bubbles, move up/down via existing handler).
      Note: markerId→survey jump has no counterpart here (this tab is the PDF outline, page-anchored) — not wired.
- [x] Spaces rows: demo touch metrics — space activate toggle 40x24 (gold), region rows 50px,
      page-assign input 28→44px with red range-parse error. Header create/export already present, sized to demo.
- [x] Spaces header: verified present + sized (32px buttons, 116w export menu).
- [x] Version history: demo rows (50px, radius 8, 9px green dot); real revision data + Restore kept.
- [x] Page thumbnail cards: copy/cut clipboard badge surfaced on mobile.
- [x] Context menus: mobile chrome (188px page menu browser-verified: #181B20/r9/#3C424D + full action
      set; 176px annotation / 154px paste via passive long-press reusing desktop handlers, works under Select).
- [~] DEFERRED (documented, no broken code shipped): DOM-free annotation hit-test under the Pan tool
      (a pre-existing canvas-presentation known bug, not introduced here) + region long-press delete menu —
      both need model-geometry hit-testing verified on-device.

**Phase D DONE 2026-07-12, commit 3054043e.** Adversarial review PASS (no desktop regression, no new
store writes). Build + 1955 tests green; mobile page menu browser-verified at 390x844.

## Phase E — Formatting-bar gaps & smaller feature deltas

`matrix.md` §6, §9.

- [x] **Edit panel for non-text tools**: full edit sheet now opens for pen/highlighter/shapes/line/
      arrow/counter with adaptive fill/stroke/width/arrowhead cards. Eraser stays strip-only (deliberate —
      it has only mode+size, no color/fill).
- [x] **Color picker**: all 6 native `<input type=color>` replaced with the shared CompactColorPicker
      (one-picker rule) in a mobile takeover surface — presets + spectrum + opacity + hex. Verified 0
      native color inputs remain. (Gradient-square DRAG is still mouse-only on touch — flagged to Phase F;
      presets/opacity-slider/hex all work on touch.)
- [x] **Opacity control**: provided by CompactColorPicker's own opacity slider; the dead CSS stub deleted.
- [x] Preset color row (9 colors, 30px cells) now renders for every tool, not just text.
- [x] Fit Height zoom option — added to the mobile zoom menu (handler already existed); browser-verified all three fit modes.
- [x] Title marquee reveal for >18-char titles + overlap fix (title stops at 50%-68px; browser-verified
      no collision with the centered page cluster at 390px).
- [x] Styled dropdowns (owner decision 3): one reusable MobileStyledSelect replaces all native `<select>`
      (module picker, eraser mode, line style, arrowhead). Verified 0 native selects remain.
- [x] Split page pill (owner decision 2): fraction-tap → inline page input, chevron-tap → zoom menu.
      Chevron/fraction tap zones widened (34px / 22px + divider) after review advisory; both browser-verified.

**Phase E DONE 2026-07-12, commit 4cd79d37.** Adversarial review PASS; chevron tap-zone advisory
addressed inline. Build + 1955 tests green; split pill, fit-height, styled dropdowns, 0-native-inputs
all browser-verified at 390x844.

## Phase F — Motion & feel (single biggest cross-cutting "feel" delta)

`matrix.md` §10, `inv-demo.md` §17.

- [x] Sheet exit animation: sheets slide down ~170ms (was display:none). Driven by setTimeout, not
      transitionend — cannot get stuck. Browser-verified: mid-close translate-down, clean collapse.
- [x] Drag-to-dismiss physics: finger-follow + velocity (dy>82 / vy>0.65) + spring-back, via new
      useMobileSheetMotion hook. Handle-only, downward-only — no scroll hijack. (Feel needs a real device.)
- [x] Zoom dropdown animation: 150ms in / 130ms out (fade + translateY + scale), pure CSS.
- [~] Panel-swap: lightweight opacity crossfade only (documented deviation — a true two-sheet dissolve
      was not wired, to avoid disturbing Phase B's content-measured height).

**Phase F DONE 2026-07-12, commit 642ebe73.** Adversarial review PASS (explicitly cleared stuck-sheet,
scroll-hijack, spring residual, Phase-B non-regression). Build + 1955 tests green; sheet open/close
browser-verified at 390x844.

---

## ✅ ALL PHASES COMPLETE — 2026-07-12

A (gold re-skin) · B (safe areas/geometry) · C (survey mobile UX) · D (de-desktop panels + menus) ·
E (formatting + shared picker + split pill) · F (motion) — all landed on local main, NOT pushed.
Commits: 19b31a2d, acfd143c, a3740f27, 3054043e, 4cd79d37, 642ebe73 (on checkpoint 23d734db).
Every phase gated on build + full suite (1955 pass / 0 fail) + adversarial review + browser check at 390x844.

**Remaining for the owner:**
- **Real-device acceptance on the iPhone 17 Pro Max** — the whole point of the phone-model rule. All
  verification so far is desk-simulated (injected 34px inset); the Expo feeds were down. Restart
  :8081/:8082 and check corner-clipping + motion feel on the actual phone.
- **Deferred-with-reason items** (each needs a decision or a sanctioned mutation, none blocking):
  survey category re-assign + module re-home (need a "move marker" store op); Pan-tool annotation
  long-press hit-test + region long-press menu (need a DOM-free geometry hit-test, tied to a
  pre-existing canvas-presentation known bug); gradient-square touch-drag in the shared color picker
  (works via presets/opacity/hex; drag is mouse-only).
- **Push** whenever ready — remember to merge origin/main first (it has the PR#775 dev-env merge local
  main lacks) and run the post-push email sweep.

## Device-adaptive safe areas — OWNER RULE (added 2026-07-12)

The owner tests on an **iPhone 17 Pro Max** — heavily rounded display corners, less usable space
in the corners than a 90°-corner device. The old demo fits his phone perfectly because it lays out
inside the insets **the phone itself reports** (react-native-safe-area-context), which encode each
model's exact curve + home-bar geometry. The web app must do the same:

- **Never hardcode inset guesses.** Every safe-area value must originate from the device at runtime
  (native shell injection / `env()` where it actually works) and flow through the single inset owner
  (Phase B S1). Different iPhones and Androids report different numbers — the layout must adapt.
- Corner-adjacent chrome (the two 44px round dock buttons, sheet edges, anything at screen corners)
  must respect BOTTOM + horizontal curve intrusion, not just the home bar.
- The shell currently injects only the bottom inset — extend injection to all four insets so the
  web side can be curve-aware everywhere (ties into Phase B S2).
- **Acceptance for all Phase B work: verified on the iPhone 17 Pro Max specifically**, plus one
  square-corner / small device (or simulator) to prove the values adapt rather than fit one phone.

## OWNER DECISIONS — all five MADE 2026-07-12 (do not re-ask; supersede any conflicting row above)

1. **Survey marker placement: drag-drawn box, like desktop.** The demo's tap-to-place numbered pin
   is NOT ported. Phase C's marker-detail-sheet work is unaffected (the sheet opens after placement
   regardless of gesture).
2. **Page pill: split tap zones.** Tapping the fraction ("3 / 12") turns it into an inline number
   input, type-to-jump (demo behavior). Tapping the chevron/dropdown arrow opens the zoom/fit
   dropdown. The prev/next page buttons survive wherever they fit naturally (they're a keeper
   superset); the combined page+zoom menu as a single surface goes away.
3. **Pickers: app-styled menus everywhere.** Line style, arrowhead, eraser mode, module picker et al.
   get demo-style dark menus matching the app; native OS `<select>` rollers are replaced.
4. **Dual home navigation is INTENTIONAL — keep both.** Correction to `audit-history.md` smell #6:
   the owner deliberately built two mobile home layouts — bottom tabs (`?mobileNav=tabs`) for the
   native app shell, and the top-left switcher / rail mode (`?mobileNav=rail`) for the mobile WEB
   browser experience. Not a zombie; do not delete. Both layouts are in scope for the polish rules
   (gold, safe areas, tap targets).
5. **Portrait-only, and LOCK the orientation.** The native app must stay portrait even when the
   phone rotates (Expo shell `app.json` already sets `"orientation": "portrait"` — keep it; mirror
   the lock in any future Capacitor config). No landscape inset work in Phase B; the left/right
   inset injection (S2) remains only as far as it serves curved-corner awareness in portrait.

## Verification mode note (2026-07-12)

Both Expo phone feeds (:8081/:8082) are currently DOWN; the web dev server (:5177) is up.
Per owner: slice-by-slice verification happens in Claude's internal browser against
`http://localhost:5177/?mobileNav=tabs&nativeShell=expo` (390x844, inject
`--native-safe-area-bottom` manually to simulate the shell). Owner's iPhone 17 Pro Max check
happens at Phase B acceptance once the Expo feeds are restarted.

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
