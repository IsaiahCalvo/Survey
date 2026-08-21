# Env unlock or next gap — 2026-08-21

**Branch:** `cursor/cloud-agent-1787327676009-d4ori`  
**Does not mark the audit goal complete.** Leftover-18 stay parked.

## Secrets hunt (names only — no values printed)

Followed `/home/ubuntu/.cursor/skills-cursor/env-setup/SKILL.md`. Cloud `environment-info`: this run has **no linked environment**. `run-info` has no injected env secrets.

| Source | Named secrets |
|---|---|
| Process env (`test -n` / name-only) | **ABSENT** `VITE_DEV_AUTO_LOGIN_EMAIL`, `VITE_DEV_AUTO_LOGIN_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, Stripe test keys, MSAL, Turnstile |
| `/proc/*/environ` | **PROC_MISS** all of the above |
| `.env` | Present. Keys only: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `.env.local` | **Missing** |
| `.env.test` | **Missing** |
| `.bot-credentials.json` | **Missing** (not read) |
| `/tmp/cursor` | Directory missing |
| `/tmp/survey-test-account-lease-*/credentials.json` | 78 leftover lease files. Top key `bots` only (`id`/`email`/`password`). **No** named env secrets. Not used (would be selecting accounts without coordinator tuples). |
| Cursor `environment.json` | None. No dashboard-injected secrets. |
| Docker | **Missing** |

**Secrets found: no.** Did not invent tokens, write `.env.local`, restart Vite for auto-login, assign a lease, or apply `20260820*.sql`.

## Leftover-18 newly fully proven

**None.** All 18 remain **partial**. Hosts unchanged from `leftover18-unblock-2026-08-21.md`.

## Track B — next unique gap

**Cluster:** mobile 390×844 chrome hit targets (desktop catalogs ≠ these buttons).

Did **not** replay every-swatch, callout paste, thin leftovers, PDF links, History restore, pages menu, flatten wave, leftover-18 fail-closed specs.

### Live-proved

Playwright `debug/scenarios/e2e-mobile-chrome-hit-targets.spec.mjs` **3 / 3 (9.2s)** on reused Vite `http://localhost:5173`. Node `tests/mobileChromeHitTargets.test.mjs` **2 / 2**.

| Slice | Intended / break / edge |
|---|---|
| Mobile viewer header / More / dock | Draw Rectangle via rail; header Undo/Redo; More Export (`clickable-link-test-annotated.pdf`) + Zoom in; Fit width; presence “You”; dock Spaces; History opens local panel with **Save version hidden**; page 0/99 clamp on 1-page. No `file.id`. |
| Mobile page jump + survey dock | `spike-120-pages.pdf`: Next/Prev 1↔2; Jump **3**; Next/Prev 3↔4; Jump 0 keeps 3. Survey dock opens template chrome. |
| Mobile hub documents | Desktop ledger hidden. Mobile search no-match; Size sort; Select Duplicate disabled→`test-copy.pdf`; More → Preview & details → Share opens **Document Access** (Invite not sent); card Open file → `?testPdf=` viewer. No `file.id`. |

### Product (min-viable)

1. `src/PDFViewer.jsx` — `commitPageInput` reads **live** `e.target.value` so Enter/blur is not a stale-`pageInputValue` no-op.
2. `src/mobile/MobilePdfViewerChrome.jsx` — attach `bottomToolbarApi.pageInputRef` on the header page field. Without it, pageNum sync treated the field as unmounted and rewrote the value on every observer tick.

Invariants unchanged: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `*`. Cap **8448 MiB / 75/250** not loosened.

Official `node scripts/run-node-tests.mjs` after the PDFViewer min-diff: main files + isolated suites reach the standing leftover `partialEraserComplexity` 500-crossing **11970.51 MiB > 8448.00 MiB**. Not loosened. Lease classifier now treats leftover-18 `.bot-credentials.json` **absence** asserts as fail-closed (not leased entry points).

### Still thinner / parked

- Leftover-18 hosts (auto-login, captcha, Stripe, MSAL, second account, native Electron pick, cloud persist).
- Measurement / calibration as a user tool: **not compiled-in** (internal Electron-factor calibration only).
- Image/stamp create: **not a `?testPdf=` tool** (prior stamp-export receipt).
- Custom Print panel: compile-gated `PRINT_PANEL_ENABLED=false`.
- Keyboard shortcut overlay: still home-tab only; not a new viewer matrix.

## Files

- `src/PDFViewer.jsx`
- `src/mobile/MobilePdfViewerChrome.jsx`
- `debug/scenarios/e2e-mobile-chrome-hit-targets.spec.mjs`
- `tests/mobileChromeHitTargets.test.mjs`
- `tests/testAccountLease.test.mjs`
- `.planning/logic-audit-2026-08-20/E2E-STATUS.md`
- this receipt

Goal stays open.
