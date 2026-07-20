# Testing Patterns

**Analysis Date:** 2026-07-19 (updated from Syncfusion-era 2026-03-17 sheet)

## Test Framework

**Runner:**
- Node.js native test runner (`node:test`) via `scripts/run-node-tests.mjs`
- Playwright for scenario / e2e testing (`@playwright/test`)

**Assertion Library:**
- Node.js `assert/strict` for unit tests
- Playwright `expect()` for e2e

**Run Commands:**
```bash
npm test                    # tests/** + src/**/__tests__/** (*.test.mjs)
npm run test:integration    # needs .env.test + SUPABASE_INTEGRATION=1
npm run test:privacy        # storage privacy tripwire (same env)
npm run test:debug          # Playwright — debug/playwright.config.mjs
npm run debug:scenario      # Playwright --grep <name>
npm run debug:process       # Post-process debug artifacts
```

## Test File Organization

**Location:**
- Unit tests: `tests/**` and co-located `src/**/__tests__/**`
- Scenario / e2e: `debug/scenarios/` (inventory grows often — list the directory rather than hardcoding filenames here)
- Fixtures: `debug/fixtures/` (served in DEV at `/debug-fixtures/`)

**Naming:**
- Unit: `*.test.mjs`
- Playwright scenarios: follow existing `debug/scenarios/` conventions

## Viewer / e2e selectors

Live pdf.js viewer container class: `.survey-pdfjs-viewer-container`.
Do **not** wait on Syncfusion selectors such as `.e-pv-viewer-container` — that engine is gone.

For no-auth annotation smoke in DEV:
`http://localhost:5173/?testPdf=<fixture.pdf>` (see `AGENTS.md`).

## Baseline

Re-run `npm test` and report current pass/fail/skip counts. Absolute numbers drift as suites grow. Verified offline on 2026-07-19: **2233 pass / 0 fail / 36 skip**.

## What unit tests do NOT cover

No automated unit suite fully mounts the PDF viewer / AppShell chrome. UI changes still need a running app (`npm run dev` or `npm run dev:ui`) before calling them done.

---

*Testing analysis: 2026-07-19*
