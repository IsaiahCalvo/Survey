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

- Branch: `claude/hopeful-lewin-18894a` (FF'd from `claude/vibrant-lewin-6d7e06`; ahead of `origin/main` @ `707a9ffd`). **NOT pushed** (push only after owner approval — test on dev server first).
- Callout keystone commits this session: `6c0e3074` (R2.1 Supabase sole-writer), `8900c16b` (comment), `776ce0c3` (**flip default ON**). Backfill `--apply` RAN against prod (11 rows → `.fabricObject`).
- Gates everywhere: `npx vite build` && `node scripts/run-node-tests.mjs` → **1686 pass / 0 fail**. For any batch touching `src/PDFViewer.jsx`, also run `node agent-cli/render-smoke.mjs`.
- Callout flag: `calloutsInSharedStore()` (`src/lib/calloutSharedStoreFlag.js`), now **DEFAULT ON** (flipped 2026-06-29). Kill switch: `localStorage.CALLOUTS_SHARED_STORE='0'` (or env `VITE_CALLOUTS_SHARED_STORE=0`).

---

## TRACK A — Callout unification (PRIORITY; data-sensitive)

Owner decision (2026-06-28): **full migration of DB rows to the `annotation_data.fabricObject` shape** (cleanest on-disk parity), NOT the lazier keep-normalized variant.
Footprint: prod has **11 callout rows across 8 docs**; survey-test is empty.

Authoritative detail: **`.planning/callout-unification/KEYSTONE-WIRING.md`** (top "UPDATE — 2026-06-28" block + the file:line **"R2 EXECUTION MAP"**) and `.planning/callout-unification/PLAN.md`.

### DONE — keystone LIVE (2026-06-29)
- ✅ **R2.1 Supabase sole-writer** (`6c0e3074`): serialize guard flag-gated (flag-ON serializes callout objects into `.fabricObject` rows), legacy callout push disabled flag-ON, `calloutToAnnotationObject` embeds `data.legacyCallout`+`authorId`+root `isPdfImported` (byte-shape-identical to backfill). Y.Doc guard `:202` + `CRDT_FAN_OUT_EXCLUDED_TYPES` intentionally KEPT (Supabase-only for now; CRDT is R2.3).
- ✅ **Adversarial gate passed** (3 passes: correctness + RLS + code-review). No single-user/data-loss blockers. Live RLS-enforced cloud-write proof. Collaborator-can't-delete-owner confirmed at the RLS layer.
- ✅ **Flip** (`776ce0c3`): `calloutsInSharedStore()` DEFAULT ON; '0' kill switch.
- ✅ **Backfill `--apply` RAN** against prod `cvamwtpsuvxvjdnotbeg`: 11/11 rows `.callout` → `.fabricObject`, 0 legacy remain, all 11 shim-reloadable. Backward-read shim + script were landed earlier (lossless, idempotent).

### LEFT — POST-FLIP cleanup (owner chose gate→flip→THEN cleanup; do FRESH + adversarial)
1. **R2.2 derive-model** — make `annotationsByPage` the IN-MEMORY source (callouts derive from `data.legacyCallout`; `setCallouts`→`projectCalloutsIntoByPage`), retire the ~25 `setCallouts` reads/writes, wire callout delete through `handleRequestBulkDelete`/`buildBulkDeletePlan` (this ADDS the missing cross-author confirm modal — gate Finding), undo onto the shared delta lane. Handle the undo snapshot/restore seam carefully (calloutsRef mirrors derived; avoid double-restore vs the annotationsByPage snapshot). Touches `PDFViewer.jsx` heavily.
2. **R2.3 realtime/CRDT** — fix the KNOWN collab-only gate findings (all bounded / non-data-loss; multi-user is pro+ gated = NOT active): (a) **realtime echo re-push** — `onCalloutInsert/Update/Delete` (`useAnnotationCloudSync.js:2932-2951`) update `lastCalloutsRef` but NOT `lastByPageRef`, so the projection-driven shared push re-pushes echoed callouts (churns `last_modified_by`); fix = route remote callouts through the shared `lastByPageRef`-suppressed path like `onFabricInsert`. (b) **attribution-on-reload** — `legacyCallout` deep-copied before `meta.authorId` stamp. Reverse Y.Doc guard `annotationDocStore.js:202` + drop 'callout' from `CRDT_FAN_OUT_EXCLUDED_TYPES`. Each needs its own adversarial pass.
3. **Phase 8 dead-code** — delete the forked sync (`upsertCallouts`, six fingerprint refs, `calloutSyncPayload.js`, `calloutHistoryScope.js`, `deserializeRowsToCallouts`, dead `loadCalloutAnnotation` in `FabricEditCanvas.jsx`, etc.) once R2.2/R2.3 land + a release cycle.

---

## TRACK B — Ponytail cleanup (parallel-friendly; "one by one, carefully")

Authoritative detail with every file:line target: **`debug/ponytail-audit/REMAINING-EXECUTION-PLAN.md`** (and report `debug/ponytail-audit/REPORT.md`). Already landed: ~3,776 lines of dead code + 8 deps cut.

Remaining batches (safest first):
1. **small-dead-bits** (LOW, no sign-off) — ~21 dead icon entries / dead exports / redundant `export default` lines across `Icons.jsx`, `Callout/types.js`, `excelLockFile.js`, `excelCapability.js`, `microsoftConnectionMarker.js`, 6 hook files. One commit.
2. **deps** (LOW) — remove redundant devDeps (`ws`, `cross-env`, `buffer`, `events`, `stream-browserify`, `util`), drop `dev:legacy`+`concurrently`, move `@capacitor/cli` to devDeps. **`wait-on`/`dev:electron` → KEEP** (resolved 2026-06-28: that IS the owner's desktop test launcher — `wait-on … && electron .`).
3. **stdlib-rewrites** (LOW–MED; 1 item HOLD) — ~25 hand-rolled ID generators → `crypto.randomUUID()`; `JSON.parse(JSON.stringify())` → the shared `deepClone`. **Touches `PDFViewer.jsx` + several callout files → conflicts with Track A; do after/around R2, not concurrently.** The invite-token security fix is **DONE** (`documentInviteService.js`, fail-closed, `f79a9a62`). Hex helpers HOLD (polyfill check).
4. **pdfviewer-deadcode** (LOW–MED) — dead branches behind the hardcoded-true `usePdfjsRenderer` flag, in atomic batches 4a–4e. **All in `PDFViewer.jsx` → conflicts with Track A; do after R2.** The overlay-recorder item (4f) is **DONE** (deleted 2026-06-28, `f79a9a62`). NEVER touch the live KAL-241 lines (`5437`, `5609`, `1894–1899`).
5. **mobile-monolith** (LOW steps 1–11; step 12 NEEDS-OWNER) — split `mobile-expo-go/App.tsx` (9,319 lines) into ~25 files via 12 ordered steps. **Entirely separate files → fully parallel-safe with everything else.**

**Deferred / parked (NOT in scope):** the **PrintPanel** cleanup is owner-deferred (2026-06-28) — not happening today or soon. Tracked in **Linear KAL-315**, an Obsidian note, and a code marker above `PRINT_PANEL_ENABLED` in `PDFViewer.jsx`. Removal map (for when it's revived) stays in `debug/ponytail-audit/REMAINING-EXECUTION-PLAN.md` §6. Do not action it.

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
| 1 | Mobile step 12 (`useDocumentState` hook extraction) needs you to test on a real device after | `mobile-expo-go/App.tsx` |

**Resolved 2026-06-28:** dev:electron → KEEP (it's the test launcher); invite-token security fix → DONE (fail-closed); overlay lag recorder → REMOVED. PrintPanel → deferred (KAL-315).

---

## Working rules (carry forward)

- **Commit each increment immediately** (shared worktrees + loop fleet can clobber uncommitted work); re-merge/FF `main` if it moves; **push only after owner approval**.
- Keep every callout increment **flag-gated / flag-OFF byte-identical** until the deliberate flip.
- Every batch passes the build + test gate; add `render-smoke.mjs` for `PDFViewer.jsx` batches.
- Backfill `--apply` is the only prod-mutating step; data is disposable (app not published) but still validate logic first and run it coupled with the flip.
- Never touch the live KAL-241 perf lines. PrintPanel is deferred (KAL-315) — leave it alone.
