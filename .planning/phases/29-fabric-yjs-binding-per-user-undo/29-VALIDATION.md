---
phase: 29
slug: fabric-yjs-binding-per-user-undo
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-28
---

# Phase 29 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (unit) + Playwright (e2e) — already established in Phases 27/28 |
| **Config file** | `vitest.config.ts` + `playwright.config.ts` |
| **Quick run command** | `npx vitest run --no-coverage src/lib/collab/` |
| **Full suite command** | `npx vitest run && npx playwright test` |
| **Estimated runtime** | ~60 seconds (unit) + ~120 seconds (e2e) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --no-coverage src/lib/collab/`
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 29-01-01 | 01 | 0 | scaffold | wave-0 stubs | `npx vitest run src/lib/collab/__tests__/` | ❌ W0 | ⬜ pending |
| 29-02-01 | 02 | 1 | identity contract | unit | `npx vitest run crdtAnnotationBridge.test` | ❌ W0 | ⬜ pending |
| 29-02-02 | 02 | 1 | echo-loop guard | unit | `npx vitest run echo-loop.test` | ❌ W0 | ⬜ pending |
| 29-02-03 | 02 | 1 | per-property LWW (COLLAB-03) | unit | `npx vitest run lww.test` | ❌ W0 | ⬜ pending |
| 29-02-04 | 02 | 1 | tombstone resurrection (UNDO-03) | unit | `npx vitest run tombstone.test` | ❌ W0 | ⬜ pending |
| 29-03-01 | 03 | 1 | UndoManager origin scoping (UNDO-01/02) | unit | `npx vitest run crdtUndoManager.test` | ❌ W0 | ⬜ pending |
| 29-03-02 | 03 | 1 | redo (UNDO-04) | unit | `npx vitest run redo.test` | ❌ W0 | ⬜ pending |
| 29-03-03 | 03 | 1 | stopCapturing boundary | unit | `npx vitest run captureBoundary.test` | ❌ W0 | ⬜ pending |
| 29-04-01 | 04 | 2 | useSyncExternalStore subscribe | unit | `npx vitest run useAnnotationsCRDT.test` | ❌ W0 | ⬜ pending |
| 29-04-02 | 04 | 2 | App.jsx Cmd+Z/Cmd+Shift+Z waiver | e2e | `npx playwright test undo-keyboard.spec` | ❌ W0 | ⬜ pending |
| 29-05-01 | 05 | 2 | FabricEditCanvas commit waiver | e2e | `npx playwright test edit-commit.spec` | ❌ W0 | ⬜ pending |
| 29-05-02 | 05 | 2 | concurrent edits (COLLAB-02) | e2e | `npx playwright test collab-different-shapes.spec` | ❌ W0 | ⬜ pending |
| 29-05-03 | 05 | 2 | concurrent same shape (COLLAB-03) | e2e | `npx playwright test collab-same-shape.spec` | ❌ W0 | ⬜ pending |
| 29-05-04 | 05 | 2 | per-user undo (UNDO-01/02) | e2e | `npx playwright test undo-per-user.spec` | ❌ W0 | ⬜ pending |
| 29-05-05 | 05 | 2 | 1000-stroke smoke (no echo loop) | perf | `npx playwright test stroke-smoke.spec` | ❌ W0 | ⬜ pending |
| 29-06-01 | 06 | 2 | remote-delete toast | e2e | `npx playwright test remote-delete-toast.spec` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/collab/__tests__/crdtAnnotationBridge.test.ts` — stubs for COLLAB-02, COLLAB-03, identity contract, echo-loop
- [ ] `src/lib/collab/__tests__/crdtUndoManager.test.ts` — stubs for UNDO-01, UNDO-02, UNDO-03, UNDO-04
- [ ] `src/hooks/__tests__/useAnnotationsCRDT.test.ts` — stub for subscribe/unsubscribe lifecycle
- [ ] `tests/e2e/collab/undo-per-user.spec.ts` — Playwright stub (canonical UNDO-02 test)
- [ ] `tests/e2e/collab/collab-different-shapes.spec.ts` — Playwright stub (COLLAB-02)
- [ ] `tests/e2e/collab/collab-same-shape.spec.ts` — Playwright stub (COLLAB-03)
- [ ] `tests/e2e/collab/stroke-smoke.spec.ts` — 1000-stroke perf stub
- [ ] `tests/e2e/collab/remote-delete-toast.spec.ts` — remote-delete UX stub
- [ ] Shared fixture: two-client harness (`tests/e2e/collab/_fixtures/twoClients.ts`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cross-page undo navigation feels right | UNDO-01 | Visual UX timing — automated test verifies state but not "feel" | Open page 6, draw, jump to page 3, draw, press Cmd+Z — page should auto-jump back to page 3 before stroke disappears |
| Mid-drag remote update is invisible | echo-loop UX | Cannot reliably script two-client mid-drag timing | Two clients: A starts dragging shape, B edits same shape's color; A should not see B's update until A's mouseup |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
