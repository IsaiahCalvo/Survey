---
phase: 27
slug: crdt-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-27
---

# Phase 27 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (planner to confirm — Wave 0 installs if not present) + Playwright (existing) + `node --test` for the applyUpdate-only invariant grep assertion |
| **Config file** | `vite.config.js` covers Vitest setup; `playwright.config.{ts,js}` for E2E; new `scripts/check-applyupdate-invariant.test.mjs` for the node:test grep |
| **Quick run command** | `npm run test:unit -- --run` (Vitest run-mode) |
| **Full suite command** | `npm run test:unit -- --run && npm run test:e2e && npm run check:licenses && node --test scripts/check-applyupdate-invariant.test.mjs` |
| **Estimated runtime** | ~90 seconds (unit ~5s, E2E ~60s, license-check ~15s, invariant grep ~2s) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit -- --run` (Vitest fast unit suite)
- **After every plan wave:** Run full suite (unit + E2E + license-check + invariant grep)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds for unit, ~90 seconds for full

---

## Per-Task Verification Map

> Populated by gsd-planner. Every task in every PLAN.md must map to one row here. Failure to populate = Dimension 8 fail in plan-checker.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | AUTH-03 | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 sets up the test scaffold before any production code lands. Items below are derived from `27-RESEARCH.md` § Validation Architecture and § Workstream W0.

- [ ] `npm install --save-dev vitest @vitest/ui happy-dom` — install Vitest if not already present
- [ ] `npm install --save-dev license-checker` — license CI gate dep
- [ ] `tests/unit/ydoc-registry.test.ts` — stub for Y.Doc registry contract (covers SC1, SC4)
- [ ] `tests/unit/web-locks-election.test.ts` — stub for lock acquire/release/handoff (covers SC2)
- [ ] `tests/unit/applyUpdate-only.test.mjs` — `node --test` grep assertion that `new Y.Doc(` appears only in `src/lib/yjs/ydoc-registry.{ts,js}` (covers SC4)
- [ ] `tests/e2e/yjs-roundtrip.spec.ts` — Playwright: open PDF → annotate → reload → assert state restored (covers SC1)
- [ ] `tests/e2e/yjs-multitab.spec.ts` — Playwright: two tabs same doc, leader/follower BroadcastChannel handoff, no IDB double-write (covers SC2)
- [ ] `scripts/check-licenses.mjs` — wraps `license-checker` with allowlist (MIT/BSD/Apache/ISC/CC0/0BSD/Unlicense) (covers SC5)
- [ ] `package.json` script entries: `test:unit`, `test:e2e`, `check:licenses` (Wave 0 commit; landing here is the per-phase package.json waiver scope)
- [ ] CI workflow updated to run all four gates on PR

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Storage-failure banner UX in private browsing / disabled IndexedDB | (CONTEXT decision) | IndexedDB-disabled mode is hard to simulate reliably in Playwright; manual confirmation that banner copy is clear and dismissible | 1. Open Chrome → DevTools → Application → Storage → Disable IDB. 2. Open a PDF. 3. Banner should appear with copy explaining offline-local state. 4. Confirm dismissal does NOT silence the banner. |
| Desktop-app single-window enforcement | (CONTEXT decision) | Electron multi-window flow not in CI; verify second open brings existing window forward | 1. Launch desktop app. 2. Open document A. 3. From a separate launch path, attempt to open document A again. 4. Confirm no second window — existing window focuses. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (all commands run-mode only)
- [ ] Feedback latency < 90s for full suite, < 5s for unit
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
