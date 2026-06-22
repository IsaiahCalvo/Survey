# Next session — autonomous annotation-lifecycle test harness

_Captured 2026-06-05. User's directive: build a self-driving harness so Claude can test the FULL annotation lifecycle end-to-end against the real app + real backend, with ZERO user involvement, and use it to bang out the persistence bugs one by one. Fragile/delicate files are fair game — minimum-diff still applies, but no "I can't test this" excuses._

## The goal
One command/skill that runs the whole chain and reports DB + UI state at every step:
1. Draw a stroke → 2. Save (autosave + Cmd/Ctrl+S) → 3. Inspect the database row → 4. Close the app → 5. Reopen → 6. Confirm the stroke returns.
Plus the same rigor for: embedded-PDF annotation import → save to DB; delete behavior (does deleting a file/doc remove its rows?); re-upload the same file; offline draw → reconnect.

## What already exists (reuse, don't rebuild)
- `agent-cli/` — authenticates as the real dev user, drives the real Supabase backend, times save/load. Commands: `docs`, `open <id>`. Scripts: `survey-roundtrip.mjs`, `proof-snapshot-invariant.mjs`.
- `agent-cli/roundtrip-save-reopen.mjs` (built this session) — backend-level draw→save→poll-DB→reload→assert-returns→cleanup, idempotent. THIS IS THE TEMPLATE for the data-truth half.
- `agent-cli/reupload-survival.mjs` — reuse-decision + mark presence.
- Playwright MCP + kapture MCP — can drive the LIVE app (dev server :5173). `?testPdf=...&pdfEngine=pdfjs` route. `window.__debugBridge.snapshot()`, `window.__renderedAnnotationRegistry`.

## The one real constraint (decides the architecture of the harness)
- A genuine mouse pen-stroke + Cmd+S only COMMIT in the LIVE running app. Under headless `npx playwright test`, the stroke does NOT commit (readiness/timing gap — documented failure of `debug/scenarios/annotation-draw-render.spec.mjs`). It DID commit when driven via the Playwright MCP against the live app.
- ⇒ The harness must drive the REAL running app (dev server up), not a headless spawn, for the true UI flow. The backend-truth checks run directly via agent-cli + the Supabase service key.

## Harness design to build
- **Layer A — data truth (agent-cli):** fully autonomous already. Open a throwaway test doc, write a mark via the real save path, confirm the DB row, reload, confirm, clean up. Extend `roundtrip-save-reopen.mjs` into a parameterized lifecycle runner covering import + delete + re-upload.
- **Layer B — real UI (Playwright/kapture MCP against live dev server):** arm the pen via the toolbar Draw button, stroke with the mouse, fire Cmd/Ctrl+S, read `__renderedAnnotationRegistry` + `__debugBridge.snapshot()`, then reload and re-check. Pair each UI action with a Layer-A DB peek so we see exactly where a mark is lost (rendered? in React state? in the DB? gone on reload?).
- **One driver** that runs A+B in sequence per scenario and prints a step-by-step ledger (rendered / saved-to-db / survived-reload / restored) with the document id and counts. Likely a skill or a `/gsd`-style command so it's repeatable.

## One-time setup needed from the user
- Leave the dev server running (or let Claude start it) so the live app is drivable.
- A throwaway test document + (ideally) a non-live test account/project so the harness never churns real survey data. Confirm which doc/account to use.

## Then: use it to fix the real bug
With the harness proving each step, work the rebuild root cause (KAL-271 etc.): make embedded import persist instantly, confirm the live draw→save→reopen survives, and only then proceed through the phases. The harness becomes the per-fix proof.

## Open question to settle at session start
- Cmd+S "does nothing" (user report 2026-06-05): confirm whether the manual-save handler is wired for cloud docs at all, or only fires for local-file docs — this is a concrete first thing the harness should expose.
