# Official Home overlay mount contract — 2026-08-23

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Tip before this pass:** `cea7a3c2` after-Home-shortcuts hunt.  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

Unique leftover after Home `?` singleton (`afac0655` / `8373deda`) + after-Home-shortcuts hunt (`cea7a3c2`). Dedicated overlay contracts already required `!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay`. Official `tests/keyboardShortcutMatrix.test.mjs` and `tests/mobileChromeHitTargets.test.mjs` still required the pre-gate mount `!isViewerVisible && <KeyboardShortcutsOverlay` — official fail **2 / 38** (`ERR_ASSERTION` match on AppShell). Distinct from leftover-18 / X-01 / remapped-after-CW / dismiss-family / rail-toggle family / Home tab / Home `?` product replay / Close tab / font-color skip.

**Product:** none. Live AppShell already skips the Home overlay on `?testPdf=` (`isDevTestPdfRoute`); DevTestRoute remounts the single instance. Official leftover files now match the live mount. Isolated 8448 standing. Cap **8448** / 75/250 not loosened.

Did **not** invent a lease, plus-alias, or `file.id`. Did **not** write another X-01 parking note. Did **not** pad FEATURE-MATRIX. Did **not** write a 103-ID refresh. Did **not** replay Home `?` / rail-toggle / dismiss-family / kal412 / se011 / spike / hub More.

## Hunt (why this leftover)

Axis this turn: official tests that FAIL or assert stale live strings. Not a fixture / hub More / rail-toggle / dismiss replay.

| Candidate | Verdict |
|---|---|
| X-01 / leftover-18 hosts | **Parked.** `.env.local` names PRESENT; process env absent; no coordinator `scripts/test-account-lease.mjs` token; no real `file.id`. |
| Dedicated `shortcutsOverlay` / `homeShortcutsOverlaySingleton` | **Already aligned** to `!isDevTestPdfRoute`. |
| **`keyboardShortcutMatrix` + `mobileChromeHitTargets`** | **This pass.** Still required the pre-`afac0655` mount. Official fail **2 / 38**. |
| Other official AppShell overlay mounts | **No more stale requires.** Remaining `!isViewerVisible && <KeyboardShortcutsOverlay />` lines are `doesNotMatch` guards. |
| Exclusive-layer / popover / dismiss `mousedown` | Already `pointerdown`. Fit `listbox` already `doesNotMatch`. |
| Rail-toggle / dismiss-family / Home tab / Home `?` / Close tab | **Exhausted / do not replay.** |
| Font-color create-tool dismiss | **Skip** (rich-text-only; exclusive-layer `pointerdown`). |
| Annotation context *actions* / History besides Restore / 390 More besides Export/Zoom | Already dedicated (UL-27–31 / A-07 / toolbar-zoom). |
| Search Match case / Whole word / Comments / Forms / Print / Actual size / Measure / Group / Extract / Note / Marquee zoom / Layers / Attachments | **0** / compile-hidden. |

## Live-proved

Focused Node before align: `keyboardShortcutMatrix` + `mobileChromeHitTargets` + `shortcutsOverlay` + `homeShortcutsOverlaySingleton` + `e2eUnlistedControls` + leftover18 **36 / 38** (2 stale-mount fails). After align: those files + `officialOverlayMountAlign` + leftover18 **40 / 40**.

| Slice | Intended / break / edge |
|---|---|
| Intended official | AppShell mount is `!isViewerVisible && !isDevTestPdfRoute && <KeyboardShortcutsOverlay`. DevTestRoute still remounts one. |
| Break official | Leftover files do **not** match `!isViewerVisible && <KeyboardShortcutsOverlay />`. Official fail **2 / 38** is gone. |
| Edge official | Dedicated singleton + V-09 overlay contracts still lock the gate. leftover-18 **12 / 12**. Isolated 8448 standing. |
| Lease | Process auto-login / service-role **absent**. No lease token. `file.id` not invented. |

No product edit. Canvas sizing / `zoomGeneration` / SVG viewBox / Fabric `fontFamily` / CORS `*` untouched. High-risk files not edited; official `npm test` not required this pass. Cap **8448** / 75/250 not loosened. Isolated 8448 standing. `graphify` CLI absent.

## Leftover-18

Still **18** fail-closed local + **18** host-gated. Next live host remains **X-01** (coordinator lease via `scripts/test-account-lease.mjs` + real saved `file.id`). Do **not** re-claim unblocked GAP = 0.

## Files

- `tests/keyboardShortcutMatrix.test.mjs`
- `tests/mobileChromeHitTargets.test.mjs`
- `tests/homeShortcutsOverlaySingleton.test.mjs`
- `tests/officialOverlayMountAlign.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md` (this-pass only)
- `.planning/logic-audit-2026-08-20/E2E-UNLISTED.md` (this-pass only)
- this receipt

Goal stays open.
