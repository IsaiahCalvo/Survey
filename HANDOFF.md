# Handoff — Persistence rebuilt (Yjs source of truth). Pass 1 done + live-verified.

**Updated:** 2026-06-06. **Branch:** `main` (local-only, unpushed — direct-to-main; push only on the user's say-so). **Status:** Pass 1 (single-user durability) COMPLETE and verified live against the real backend. Pass 2 (live teammate sync) + dead-code cleanup remain.

## What got fixed (all four of the user's bullets) — verified live on the real 36-page Package 2
1. **Save works on a fresh upload.** A file's identity is now derived from its bytes (content hash) and resolved BEFORE it opens, so the viewer always has a real document id. No more null-id window; the save shortcut and autosave actually reach the cloud.
2. **Marks no longer vanish on reload.** The open document is the single source of truth (Yjs Y.Doc), every change is written to a durable append-only log instantly, and reopen rebuilds from a full-state checkpoint + the log. No clear-and-refan, no empty/partial overwrite.
3. **No blank/duplicate documents.** Same bytes dedup to one document (content hash + unique index); embedded marks import once and persist to the log.
4. **Delete removes the marks.** Hard-delete cascades the log + checkpoint + legacy rows away, removes the stored PDF, and purges the local copy.

### The fundamental fix for the partial-vanish (marks past page 7)
Root cause (proven by decoding the user's actual doc): a multi-page embedded import was captured as ONE ~3.5MB op — one failed write lost everything but a later tiny edit. Fix: **one bounded op per page** + a **debounced, retried, gzipped full-state checkpoint** that self-heals any dropped op (open = checkpoint + tail). Verified live: upload Package 2 → 6 per-page ops + checkpoint; reload+reopen → all 3056 marks across pages 6–11 restored, pages 8/9/10 render fully.

## The architecture (the rebuild)
- `src/services/annotationDocStore.js` — pure engine: byPage⇄Y.Doc mapping (minimal per-page diff), snapshot+tail hydrate. Node-tested.
- `src/services/annotationDocSync.js` — durable wiring: y-indexeddb local-first, append each change to the `annotation_updates` log, debounced gzipped checkpoint to `annotation_snapshots` (retried), Realtime subscribe, `purgeAnnotationDoc` for delete. Y.Doc via `ydocRegistry` under an `annoflat:` key (respects the applyUpdate-only invariant).
- `src/hooks/useAnnotationDoc.js` — viewer seam: hydrate from the store, capture every `annotationsByPage`/`callouts` change, `forceFlush` for Cmd+S. Loop-free (minimal-diff + local edits don't echo).
- `src/PDFViewer.jsx` — legacy `useAnnotationCloudSync` set inert (enabled/hydrateEnabled false); the new hook owns persistence + the hydration signal that drives the existing import-when-empty path.
- `src/Dashboard.jsx` + `src/hooks/useDatabase.js` — content-hash upload + dedup + hard delete. `src/services/contentHash.js` — SHA-256.
- Migration `20260606120000_rebuild_yjs_source_of_truth.sql` (pushed): `annotation_updates`, `annotation_snapshots`, `documents.content_sha256` + `embedded_import_completed_at`, dedup index, Realtime on the log.
- Proof tools: `agent-cli/yjs-roundtrip.mjs` (durable path vs real backend), `agent-cli/lifecycle-harness.mjs`. Suite 927/921/0/6, vite build clean.

## Remaining
- **Pass 2 — live teammate/multi-device sync.** Realtime already publishes the log; needs a server-authored `document_annotations` projection (search/RLS) + presence/cursors, and a hosting decision for the small always-on helper so it works over the internet. (Task #7.)
- **Cleanup — remove now-inert legacy patches** once confirmed unreferenced + regression-tested: `mergePreservingImportedMarks`, `resolveSafeSnapshot` cloud guard, watermark-skip, clear-and-refan in `useAnnotationCloudSync`, the unused `persistImportedMarksToCloudForUpload`, and eventually the whole legacy hook. KEEP the self-heal import effect (now the load-bearing embedded-import path). (Task #8.)
- **Minor polish:** first-ever upload shows transient storage 400s (viewer fetches the content URL a beat before the background byte-upload finishes; renders from the local file, harmless, gone on reopen).

## Notes
- Verified in the browser preview (`npm run dev:ui`, :5174) via Playwright MCP. The Electron upload path was rewired identically — user should also smoke-test in the real app.
- Existing pre-rebuild cloud docs (old `document_annotations` marks) won't show under the new store until re-uploaded — clean cutover, no migration (user's call: they re-upload).
- Test docs were cleaned from the dev account; real surveys untouched.
