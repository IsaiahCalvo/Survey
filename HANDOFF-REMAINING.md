# HANDOFF — Everything Left (Callout Unification + Ponytail Cleanup)

_Master index of all remaining work, written 2026-06-28. For a fresh session/agent to resume._
_Plain-English summary at top; precise execution detail lives in the linked docs._

## Plain-English summary (for the owner)

Two tracks remain:

1. **Callout unification** — moving the "arrow + label" annotation onto the same shared
   system every other tool uses. The safe, isolated pieces are done and tested; the big
   risky rewrite is mapped but not started. This is the priority.
2. **Ponytail cleanup** — deleting dead/over-built code and modernizing a few helpers.
   A lot already landed; the rest is scoped into small batches.

Everything done so far is behind an OFF switch or in an un-run script, so **nothing users
see has changed**. A few items need a yes/no from the owner before an agent can proceed —
see **Owner decisions needed** near the bottom.

---

## Status snapshot

- Branch: `claude/vibrant-lewin-6d7e06` (3 commits ahead of `origin/main` @ `707a9ffd`). **NOT pushed** (push only after owner approval).
- This session's commits: `226a1391` (callout backfill script), `e76b7bc3` (callout backward-read shim), `dc28a390` (docs).
- Gates everywhere: `npx vite build` && `node scripts/run-node-tests.mjs` → **1680 pass / 0 fail**. For any batch touching `src/PDFViewer.jsx`, also run `node agent-cli/render-smoke.mjs`.
- Callout flag: `calloutsInSharedStore()` (`src/lib/calloutSharedStoreFlag.js`), DEFAULT OFF. `localStorage.CALLOUTS_SHARED_STORE='1'` to exercise locally; `CALLOUTS_SHARED=1 node agent-cli/callout-e2e.mjs` for the harness flag-ON.

---

## TRACK A — Callout unification (PRIORITY; data-sensitive)

Owner decision (2026-06-28): **full migration of DB rows to the `annotation_data.fabricObject` shape** (cleanest on-disk parity), NOT the lazier keep-normalized variant.
Footprint: prod has **11 callout rows across 8 docs**; survey-test is empty.

Authoritative detail: **`.planning/callout-unification/KEYSTONE-WIRING.md`** (top "UPDATE — 2026-06-28" block + the file:line **"R2 EXECUTION MAP"**) and `.planning/callout-unification/PLAN.md`.

### Done (landed, flag-OFF byte-identical)
- ✅ Load/render/create/edit/delete/persist behind the flag (dual-rep; verified earlier sessions).
- ✅ **Backfill script** `scripts/backfill-callouts-to-fabric.mjs` — lossless, idempotent, default `--dry-run`; validated on all 11 real prod rows (maxFracDelta ~1e-16). **`--apply` NOT run yet** (gated — see coupling rule below).
- ✅ **Backward-read shim** in `deserializeRowToCallout` — migrated rows recover via `fabricObject.data.legacyCallout`, so they load **flag-independently**. This **decouples the backfill from the flag flip** (safer than the plan's flag-coupled switch).

### Left (in order)
1. **R2 write-switch (the big, risky core).** Retire `callouts[]` as the runtime source of truth (~53 `setCallouts` sites / 113 mentions in `src/PDFViewer.jsx`), make `annotationsByPage` the source, reverse the 3 write-guards, and make the shared push the **sole** writer by disabling the legacy callout push effect (`src/hooks/useAnnotationCloudSync.js:2331–2640`). ~40 touch points / 9 clusters; 3 genuinely tricky realtime/undo seams (sync-delta, realtime echo-suppression, live-drag baseline). **Use the file:line R2 EXECUTION MAP.** Each cluster gated + committed.
   - ⚠ Reverse the 3 write-guards ONLY together with disabling the legacy push, or you get a dual-write on the same row id (the documented "BLOCKER 1" corruption).
2. **Phases 2/3/7 collapse** — bulk-delete modal via `handleRequestBulkDelete`/`buildBulkDeletePlan`, undo onto the shared delta lane, retire the forked CRDT/realtime/`upsertCallouts` sync. Falls out with R2. Plus minor: live-drag preview under the flag; delete the dead `loadCalloutAnnotation` branch in `FabricEditCanvas.jsx`; Phase-8 dead-code (`calloutHistoryScope.js`, `calloutSyncPayload.js`, `deserializeRowsToCallouts` etc.) one release after the flip.
3. **Adversarial gate** — ≥2 independent refutation passes (correctness + RLS lenses) + a code-review pass on the whole flag-ON path; harness flag-ON; a save→reopen roundtrip; a 2-user collab delete-permission check. (Memory: `feedback_adversarial_verify_realtime`.)
4. **Flip the flag default ON AND run `backfill --apply` together** (coupling rule). Once writes go `.fabricObject`, run `SUPABASE_ACCESS_TOKEN=… node scripts/backfill-callouts-to-fabric.mjs --ref cvamwtpsuvxvjdnotbeg --apply`. Idempotent — safe to re-run if a row drifted back to `.callout` from a flag-OFF edit during transition.

---

## TRACK B — Ponytail cleanup (parallel-friendly; "one by one, carefully")

Authoritative detail with every file:line target: **`debug/ponytail-audit/REMAINING-EXECUTION-PLAN.md`** (and report `debug/ponytail-audit/REPORT.md`). Already landed: ~3,776 lines of dead code + 8 deps cut.

Remaining batches (safest first):
1. **small-dead-bits** (LOW, no sign-off) — ~21 dead icon entries / dead exports / redundant `export default` lines across `Icons.jsx`, `Callout/types.js`, `excelLockFile.js`, `excelCapability.js`, `microsoftConnectionMarker.js`, 6 hook files. One commit.
2. **deps** (LOW; one item NEEDS-OWNER) — remove redundant devDeps (`ws`, `cross-env`, `buffer`, `events`, `stream-browserify`, `util`), drop `dev:legacy`+`concurrently`, move `@capacitor/cli` to devDeps. `wait-on`/`dev:electron` removal is **owner-gated**.
3. **stdlib-rewrites** (LOW–MED; 2 items NEEDS-OWNER) — ~25 hand-rolled ID generators → `crypto.randomUUID()`; `JSON.parse(JSON.stringify())` → the shared `deepClone`. **Touches `PDFViewer.jsx` + several callout files → conflicts with Track A; do after/around R2, not concurrently.** The invite-token security fix (`documentInviteService.js:35`) is owner-gated. Hex helpers HOLD (polyfill check).
4. **pdfviewer-deadcode** (LOW–MED; 1 item NEEDS-OWNER) — dead branches behind the hardcoded-true `usePdfjsRenderer` flag, in atomic batches 4a–4e. **All in `PDFViewer.jsx` → conflicts with Track A; do after R2.** Overlay-recorder `|| true` (`:9068`) is owner-gated. NEVER touch the live KAL-241 lines (`5437`, `5609`, `1894–1899`).
5. **mobile-monolith** (LOW steps 1–11; step 12 NEEDS-OWNER) — split `mobile-expo-go/App.tsx` (9,319 lines) into ~25 files via 12 ordered steps. **Entirely separate files → fully parallel-safe with everything else.**
6. **PrintPanel** — **HELD. Do not touch** until the owner picks the J or K variant (see below).

---

## Can we run this in parallel? — Yes, partially

The hard constraint is **file conflicts** (this repo has a loop fleet + parallel sessions sharing worktrees). Lanes that edit the same file will collide. Recommended concurrent lanes, each in its own worktree:

- **Lane 1 — Callout R2 (serial, careful, PRIORITY).** Owns `PDFViewer.jsx`, `useAnnotationCloudSync.js`, `annotationDocStore.js`, `annotationTypeSerializers.js`, `SVGAnnotationLayer.jsx`, `PageAnnotationLayer.jsx`. The adversarial *gate* within it can fan out to parallel agents, but the edits are one coherent change.
- **Lane 2 — Mobile App.tsx split (fully parallel).** Only touches `mobile-expo-go/` — **zero overlap** with Lane 1. Run steps 1–11 concurrently start-to-finish; stop before step 12 (needs owner device test).
- **Lane 3 — Ponytail small-dead-bits + deps GO items (parallel, quick).** Mostly separate files; one caveat: `Callout/types.js` is touched here and is callout-adjacent — do this lane's `Callout/types.js` edit **before** Lane 1 starts, or skip that one file until R2 lands.

**Must NOT run concurrently with Lane 1** (they fight over `PDFViewer.jsx` + callout files): ponytail **stdlib-rewrites** and **pdfviewer-deadcode**. Schedule those for **after** the callout R2 work lands on `PDFViewer.jsx`.

Net: you can have **3 lanes going at once** (Callout R2 + Mobile split + small dead-bits/deps), then fold in stdlib + pdfviewer-deadcode once Track A frees up `PDFViewer.jsx`.

---

## Owner decisions needed (unblock these to let agents proceed)

| # | Decision | Where |
|---|---|---|
| 1 | Does anyone run `npm run dev:electron`? (If no → remove `dev:electron` + `wait-on`) | `package.json` |
| 2 | Approve swapping the emailed **invite token** off weak `Math.random()` to `crypto.getRandomValues` (security fix) | `documentInviteService.js:35` |
| 3 | Overlay lag recorder `\|\| true`: permanently disable, or re-enable behind a proper flag? | `PDFViewer.jsx:9068` |
| 4 | Mobile step 12 (`useDocumentState` hook extraction) needs you to test on a real device after | `mobile-expo-go/App.tsx` |
| 5 | **PrintPanel**: flip `PRINT_PANEL_ENABLED=true`, try the J vs K variants, pick a winner | `PDFViewer.jsx:26490` |

---

## Working rules (carry forward)

- **Commit each increment immediately** (shared worktrees + loop fleet can clobber uncommitted work); re-merge/FF `main` if it moves; **push only after owner approval**.
- Keep every callout increment **flag-gated / flag-OFF byte-identical** until the deliberate flip.
- Every batch passes the build + test gate; add `render-smoke.mjs` for `PDFViewer.jsx` batches.
- Backfill `--apply` is the only prod-mutating step; data is disposable (app not published) but still validate logic first and run it coupled with the flip.
- Never touch the live KAL-241 perf lines or `PrintPanel` (held).
