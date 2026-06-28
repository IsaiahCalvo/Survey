# HANDOFF — Callout Unification Keystone + Remaining Ponytail

_Created 2026-06-27. For a FRESH session to resume the data-sensitive finale with full context._

## TL;DR
The callout-unification keystone is **functional behind a flag (`calloutsInSharedStore()`, DEFAULT OFF)**
and all landed work is verified + flag-OFF byte-identical (production untouched). What remains is the
**data-sensitive finale** (persistence switch + production backfill → flip) plus the remaining Ponytail
batches. Do the finale FRESH, not at the end of a long session — it mutates real callout data.

## State at handoff
- Branch/main: all work on local `main`, pushed to `origin` (IsaiahCalvo/Survey). Gates: `npx vite build`
  + `node scripts/run-node-tests.mjs` → **1668 pass / 0 fail**.
- Flag: `src/lib/calloutSharedStoreFlag.js` — OFF by default. Set `localStorage.CALLOUTS_SHARED_STORE='1'`
  to exercise the new path locally.
- Harness: `agent-cli/callout-e2e.mjs` (draw→render→select→delete→persist). `CALLOUTS_SHARED=1` flips the
  flag for flag-ON runs. The select-by-click step is flaky — retry; render assertions are reliable.

## What's DONE (flag-gated, dormant, verified)
Bridge `src/utils/calloutAnnotationBridge.js` (+`projectCalloutsIntoByPage`) · LOAD projection (local +
cloud-hydration `useAnnotationDoc`) · shared RENDER dispatch · reactive create/edit/delete + interaction
(legacy hit-targets kept, visible chrome from shared dispatch) · write-path guards exclude
`data.type==='callout'` (no storage contamination, regression-tested) · pre-flip BLOCKERS 1+2 fixed.

## REMAINING — do in this order (read `.planning/callout-unification/KEYSTONE-WIRING.md` first)
1. **Persistence switch (point D)** — persist callouts via the shared annotation path; this means
   deliberately REVERSING the `data.type==='callout'` write-guards (in `syncByPageToDoc` +
   `serializeAnnotationsByPage`) **only after** step 2's data migration, to avoid a dual-write window.
2. **Phase 6 production backfill** — migrate existing `calloutsList` (Y.Doc META) + `document_callouts`
   into `document_annotations` rows. **Dry-run on survey-test FIRST** (never the prod Survey project — see
   memory `no_docker_use_cloud_supabase` / `survey-test_supabase_project`). Design ordering so there's no
   window where a callout is double-written or missing.
3. **Phases 2/3/7 collapse** — once callouts are the source of truth in `annotationsByPage`: bulk-delete
   modal (route through `handleRequestBulkDelete`/`buildBulkDeletePlan`), undo onto the shared delta lane,
   sync onto the shared upsert/realtime path. Retire `callouts[]` + the callout-specific files.
4. **Live-drag preview** under the flag (minor; positions commit on release).
5. **≥2 fresh adversarial passes** (memory `adversarial_verify_realtime`) on the whole flag-ON path +
   harness flag-ON + a save→reopen + multi-user collab check, THEN flip the flag default ON.

## Remaining Ponytail (separate track, "one by one")
`debug/ponytail-audit/REMAINING-EXECUTION-PLAN.md` — stdlib rewrites, more PDFViewer dead code, mobile
App.tsx split. NEEDS-OWNER: `wait-on`/`dev:electron` removal, overlay-recorder block. **PrintPanel HELD**
(owner unsure it's finished — do not touch until confirmed).

## Cautions
- Every increment stays flag-gated until the flip; keep flag-OFF byte-identical.
- Backfill is the only production-mutating step — survey-test dry-run + the adversarial gate are mandatory.
- Memories to read: `project_callout_unification_status`, `reference_ponytail_remaining_work`,
  `project_agent_cli`, `reference_dual_write_queue_jam`, `feedback_adversarial_verify_realtime`.
