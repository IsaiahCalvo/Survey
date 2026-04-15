---
phase: 14
slug: unified-svg-callout-render-shared-tool-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `14-RESEARCH.md` § Validation Architecture (verified HIGH confidence).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Unit framework** | Node native test runner (`node --test tests/*.test.mjs`) |
| **Unit config file** | None — `package.json` `"test"` script invokes `node --test` directly |
| **E2E framework** | Playwright @latest (chromium project, 1400x900, 120s timeout, baseURL http://localhost:5173) |
| **E2E config file** | `debug/playwright.config.mjs` |
| **Quick run command** | `npm test` |
| **Full unit suite command** | `npm test` |
| **Full E2E suite command** | `npx playwright test --config=debug/playwright.config.mjs` |
| **Phase gate command** | `npm test && npx playwright test --config=debug/playwright.config.mjs` (113-test v2.2 baseline must remain green) |
| **Estimated unit runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** `npm test` (Node unit suite — fast, ~5 seconds)
- **After every plan wave:** `npm test && npx playwright test debug/scenarios/callout-render-roundtrip.spec.mjs debug/scenarios/delete-callout-keyboard.spec.mjs debug/scenarios/create-preview-line.spec.mjs debug/scenarios/create-preview-callout.spec.mjs debug/scenarios/tool-cursor-crosshair.spec.mjs` (Phase 14 scenario subset)
- **Before `/gsd:verify-work`:** Full unit + full Playwright suite must be green (113-test v2.2 baseline preserved).
- **Max feedback latency:** ~5s unit, ~60s E2E phase-subset, ~5min full E2E.

---

## Per-Task Verification Map

> Task IDs are placeholders — planner will assign final `{N}-{plan}-{task}` numbers when PLAN.md files land. The Req → Test mapping below is what every task in the phase MUST roll up to.

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| CALL-10 | New `renderCallout` produces SVG with `data-callout-id` + `data-callout-part` for a given React callout input | unit | `node --test tests/calloutRenderer.test.mjs` | ❌ Wave 0 | ⬜ pending |
| CALL-10 | `calloutEditAdapter.toFabricGroup` + `fromFabricGroup` round-trip preserves React callout shape within float tolerance over N=10 cycles | unit | `node --test tests/calloutEditAdapter.test.mjs` | ❌ Wave 0 | ⬜ pending |
| CALL-10 | Existing legacy callouts load + render through unified path; save+reload+save produces byte-identical Fabric.js JSON | E2E + manual | `npx playwright test debug/scenarios/callout-render-roundtrip.spec.mjs` + manual on Page 6 | ❌ Wave 0 | ⬜ pending |
| UX-01 | Activating line/arrow/callout tool switches SVG layer cursor to `crosshair`; deactivation reverts to default | E2E | `npx playwright test debug/scenarios/tool-cursor-crosshair.spec.mjs` | ❌ Wave 0 | ⬜ pending |
| KBD-01 | Delete/Backspace with single-selected callout dispatches `onDeleteSelectedCallouts`; callout removed from `setCallouts` with undo checkpoint | unit + E2E | `node --test tests/svgKeyboardHandlers.test.mjs` + `npx playwright test debug/scenarios/delete-callout-keyboard.spec.mjs` | ❌ Wave 0 | ⬜ pending |
| KBD-01 | Delete/Backspace suppressed when `document.activeElement` is INPUT / TEXTAREA / contentEditable / Fabric editing field | unit | `node --test tests/svgKeyboardHandlers.test.mjs` (same file) | ❌ Wave 0 | ⬜ pending |
| CREATE-01 | Line creation in FabricDrawingCanvas shows dashed stroke + 0.6 opacity during drag; committed line has solid stroke + opacity 1 in saved JSON | E2E | `npx playwright test debug/scenarios/create-preview-line.spec.mjs` | ❌ Wave 0 | ⬜ pending |
| CREATE-01 | Arrow creation in FabricDrawingCanvas shows dashed preview; committed arrow has solid stroke in saved JSON | E2E | (same file as line) | ❌ Wave 0 | ⬜ pending |
| CREATE-01 | Callout creation in SVGAnnotationLayer shows dashed rect + dashed connector + dashed arrowhead during drag; committed callout has solid stroke | E2E | `npx playwright test debug/scenarios/create-preview-callout.spec.mjs` | ❌ Wave 0 | ⬜ pending |
| Regression | All 113/113 v2.2 tests remain green | unit + E2E | `npm test && npx playwright test --config=debug/playwright.config.mjs` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

The planner MUST include a Wave 0 scaffold task that creates these test files BEFORE any implementation tasks land:

- [ ] `tests/calloutRenderer.test.mjs` — covers CALL-10 renderer signature + data attribute output
- [ ] `tests/calloutEditAdapter.test.mjs` — covers CALL-10 adapter round-trip precision (N=10 cycles, float tolerance)
- [ ] `tests/svgKeyboardHandlers.test.mjs` — covers KBD-01 handler logic + focus-guard branches (INPUT, TEXTAREA, contentEditable, Fabric editing field)
- [ ] `debug/scenarios/callout-render-roundtrip.spec.mjs` — covers CALL-10 full save+reload+save E2E with byte-identical JSON assertion
- [ ] `debug/scenarios/tool-cursor-crosshair.spec.mjs` — covers UX-01 cursor switching for line, arrow, and callout tool activation/deactivation
- [ ] `debug/scenarios/delete-callout-keyboard.spec.mjs` — covers KBD-01 full keyboard E2E flow + focus-guard regressions
- [ ] `debug/scenarios/create-preview-line.spec.mjs` — covers CREATE-01 line + arrow dashed-preview behavior + commit reset (Pitfall 5)
- [ ] `debug/scenarios/create-preview-callout.spec.mjs` — covers CREATE-01 callout dashed-preview behavior

No new test framework or shared fixture install is needed — `node --test` and Playwright are already wired in `package.json` and `debug/playwright.config.mjs` (verified in research).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Drag MVP — selecting a callout part (`arrowTip` / `knee` / `textBox` / `line1` / `line2`) and dragging updates React callout state; whole-move via connector-line-drag and Cmd/Ctrl+drag both work | CALL-10 | Coordinate-precision + multi-modifier interaction is hard to assert deterministically in Playwright; visual feedback matters more than asserted geometry | Open `Package 2 - Rev 4 -- IC.pdf` → Page 6 → create a callout with the `Q` tool → in the new SVG path, drag each of the 5 parts; then test connector-line whole-move and Cmd/Ctrl+drag whole-move. Confirm visual state matches expectation and store updates per drag via React DevTools |
| Cursor drift regression (2026-04-08 gotcha) | CALL-10 | Char-measurement bug only manifests in real Fabric.js Textbox with a real font load order, not in JSDOM | Open a callout in edit mode → type 30 chars into the Textbox → verify caret stays under the last typed char (no progressive drift). If drift returns, the `defaultCalloutStyle.fontFamily` CSS-fallback-stack pitfall has not been sanitized in `calloutEditAdapter.toFabricGroup` |
| Visual parity (legacy callouts) | CALL-10 | "Looks the same as before" is a human-eye check that complements the byte-identical JSON assertion | Open an existing PDF with pre-Phase-14 callouts → verify each renders in the same on-screen position with the same arrow geometry, text, color, and stroke width as before the migration |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (8 new test files)
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s unit / 60s E2E phase-subset
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
