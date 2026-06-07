# Legacy Persistence Migration — Audit Synthesis

**Date:** 2026-06-06
**Inputs:** Five parallel investigations (01–05 in this folder), the prior removal map
(`debug/fallow-audit/2026-06-06/AUDIT-cleanup-scope.md`), and the target architecture
(`.planning/optimization/PERSISTENCE-ARCHITECTURE.md`).
**Purpose:** Settle "what is on which engine" definitively, make the gating Y.Doc decision,
and lock the migrate-then-delete order for the next session.

---

## Per-kind verdict (the migration ledger)

| Data kind | Engine today | Action needed | Blast radius |
|---|---|---|---|
| Regular fabric annotations (pen, shapes) | **NEW** | none — done + proven | — |
| **Callouts** | **NEW** (rides Y.Doc `meta` key `calloutsList`) | none functional; **add test coverage** + watch latent dual-write | tiny |
| Region-scoped fabric annotations | **NEW** (they are `annotationsByPage` objects with a `regionId` field) | none for persistence; cascade-on-remote-delete is a gap | small |
| **Spaces** (+ region slots inside them) | **OLD** (localStorage + Storage sidecar via `resolveSafeSnapshot`); **no Postgres table exists at all** | migrate to Y.Doc `meta` (mirror the callouts pattern) | medium |
| **Survey markers (highlights)** | **OLD** (`documentAnnotationService.js`, full save/hydrate/delete/subscribe; separate React state, NOT fabric objects) | migrate to Y.Doc `meta`; preserve checklist-reference query + RLS detection | large |
| **Presence (who's viewing)** | **OLD** but **fully decoupled** (own table `document_presence`, own Realtime channel) | **keep as-is — no migration** | none |
| **Undo/redo** | **OLD CRDT layer** (`YDocProvider` Y.Doc keyed raw `<id>`) | rewire onto the new Y.Doc; then retire CRDT layer | large (gating) |

Two Y.Docs confirmed: new engine `annoflat:<id>` vs CRDT layer raw `<id>`. No code bridges them.
They diverge silently. `ydocRegistry.js` must be KEPT (the new sync imports it).

---

## The gating decision (write it down before coding)

**DECISION (recommended, pending Isaiah's confirmation): Option A — the new engine's Y.Doc
becomes the single Y.Doc; the CRDT collab layer is retired.**

Rationale: the new engine's append-only WAL + snapshot is the durable model we already proved;
the CRDT layer's dual-write into `document_annotations` was always temporary migration scaffolding;
the new engine is the foundation for the post-Syncfusion architecture. Undo/redo rewiring is bounded
and surgical (see 05): extend `useAnnotationDoc` to expose `{ doc, undoManager, undoCtx }`, swap the
three values destructured at `PDFViewer.jsx:9346`, and the existing three-lane undo dispatcher works
unchanged.

The alternative (Option B, merge into the CRDT Y.Doc) keeps a layer we want to delete and inherits
its dual-write fragility. Rejected unless Option A's undo rewiring proves riskier than expected.

---

## Surprises worth flagging

1. **Spaces have no database table.** RLS policies reference a `spaces` table but no `CREATE TABLE`
   migration exists in the repo. Today spaces live in localStorage + a Storage sidecar JSON only.
   Moving them into the Y.Doc actually *gives them their first real durable, collaborative home.*
2. **Callouts are silently working on the new engine but have ZERO automated proof.** The
   `annoMeta`/`calloutsList` round-trip isn't exercised by any test or harness. One flipped flag
   (`enabled:false` → true at the disabled hook call site) would re-activate a dual-write. Add a
   harness before trusting it.
3. **Presence is already where we'd want it** — ephemeral, own channel, own table, zero coupling.
   It does not belong on the durable op-log. Leave it. (Two optional hardening items: a ~60s
   heartbeat so single-page viewers don't ghost out, and a cron to purge stale rows.)
4. **Survey markers are not fabric objects** — they're bounding-box + metadata records in a separate
   React state slice, rendered as SVG rects. So they ride Y.Doc `meta` (a dict keyed by id), NOT
   `applyByPage`. Same pattern as callouts/spaces.

---

## Recommended migrate-then-delete order (smallest blast radius first)

Every step: `npx vite build` clean + `node scripts/run-node-tests.mjs` (baseline ~921/0/6) + a new
`agent-cli/*-roundtrip.mjs` harness proving save→reopen→delete on the new engine BEFORE deleting the
old path. Commit on local main; Isaiah tests on the dev server before any push.

1. **Lock callouts (cheap insurance).** Add a callouts round-trip harness + a store test for the
   meta map. No code change, just proof. Confirms the meta-map pattern we'll reuse everywhere.
2. **Spaces → Y.Doc meta.** Mirror the callouts pattern (`setMeta('spaces', …)` + capture effect in
   `useAnnotationDoc`). Replace the Storage-sidecar + `resolveSafeSnapshot` spaces branch. Lowest-risk
   real migration; proves the pattern on document-level data.
3. **Survey markers → Y.Doc meta.** The big one. Move save/hydrate/delete/realtime onto the new
   engine; preserve the checklist-item reference count and add RLS-error detection. New harness.
4. **Undo/redo rewire (Option A).** Extend `useAnnotationDoc` to expose the undo manager; swap the
   three values at `PDFViewer.jsx:9346`. Verify Cmd+Z across pen/shape/edit still works.
5. **Retire the CRDT layer.** Delete `YDocProvider`, `crdtBackfill`, `ydocLifecycle`,
   `crdtDualWriteQueue` (keep `ydocRegistry`). Remove the CRDT fan-out in the disabled hook.
6. **Delete the inert cluster, tests in the same commit.** `useAnnotationCloudSync` +
   `cloudSyncQueue` + `snapshotStore` + `mergePreservingImportedMarks`, and fix/remove the three
   no-skip-guard source-grep tests (`annotationInitialHydrationSource`, `syncStatusUi`,
   `eraserSaveHistorySyncContracts`) plus `snapshotStore.watermark` + `mergePreservingImportedMarks`
   tests, together.
7. **Drop dead tables** (`document_annotations`, `doc_yjs_state`, `doc_yjs_updates`) via migration
   once nothing reads/writes them. Presence's `document_presence` table STAYS.

Presence is intentionally absent from this list — it stays exactly as-is.

---

## What does NOT move / must NOT be touched

- Presence (`document_presence` + its channel + `useDocumentPresenceList`) — keep.
- `resolveSafeSnapshot` / `countSnapshotItems` — still live for survey + spaces hydrate until steps
  2–3 land; only removable after.
- The CLAUDE.md invariants (container-aware canvas sizing, single-name fontFamily, `zoomGeneration`
  signal, no JS zoom coordination in `SVGAnnotationLayer`) apply to every PDFViewer edit.

---

## Open question for Isaiah

Confirm **Option A** (new engine replaces the CRDT layer, undo/redo rewired onto the new Y.Doc).
Everything in steps 4–5 hinges on it. If he prefers to keep the CRDT layer, the order changes.
