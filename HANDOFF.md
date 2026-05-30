# Handoff — Survey app (2026-05-29, late session)

**Branch**: `main`, working tree CLEAN. **16 commits ahead of `origin/main`, nothing pushed** (Isaiah's direct-to-main workflow: he tests on his dev server, pushes on his own cadence). Starting a fresh session loses nothing — all work is committed.

**Context for the new session**: read `.planning/AUDIT-2026-05-29.md` (full health audit) and the session-moments log for 2026-05-29 (decisions + rationale).

---

## What got done this session (all committed to local `main`)

- **Viewer break-up, phase 2** — extracted two stateful concerns out of the 32k-line viewer into hooks, each a verbatim, gated relocation (build + `npm test` 840/0/6):
  - the annotation right-click menu → `src/hooks/useAnnotationContextMenu.jsx`
  - page operations (add/delete/rotate/reorder/etc.) → `src/hooks/usePageOperations.js`
  - Viewer is now ~32,489 lines (down ~730 today).
- **Renderer spike (throwaway)** — `?spike=renderer` dev route (`src/prototype/RendererSpike.jsx` + `NOTES.md`). Arm A (pdf.js) fully wired with a smoothness meter + a visible "crispness cliff" clamp; Arm B (EmbedPDF) is a placeholder. **Awaiting Isaiah's test on his heaviest CAD/survey sheet.**
- **Health audit** (32-agent read-only sweep) → `.planning/AUDIT-2026-05-29.md`. Overall 5/10. Strong DB/RLS + secret hygiene; the serious items are below.
- **Safe fixes shipped**: disabled the pdf.js eval path at all 13 PDF-open sites (CVSS-8.8 mitigation); deleted two dead files.
- **Annotation-fix core (test-first)**: `src/utils/pageAnnotationReindex.js` + 6 passing tests — the pure logic that shifts annotations when pages move. **NOT yet wired** (see below).

---

## NEXT — prioritized

### 1. OWNER actions (only Isaiah can — live & exploitable; do first)
- **GitHub token — DONE 2026-05-29.** Old `gho_` token revoked; replaced with a new fine-grained PAT (Survey repo, Contents R/W) in `.env.local`; verified end-to-end (auth 200 + real test push to the `logs` branch + cleanup). NOTE: the new token still bakes into future builds the same way — the real long-term fix (stop baking it / move log-push server-side, or the build-time env-key guard) is in the audit backlog.
- **Dev-login password — DONE 2026-05-29.** Old exposed password replaced via the recovery-link session (the email reset redirect points at `localhost:3000` which isn't the running dev port — that redirect URL is worth fixing in Supabase Auth URL config someday). New strong password set + verified (sign-in 200), stored in `.env.local` for auto-login (git-ignored). Same re-bake caveat as the GitHub token — proper fix (don't bake / build-time env guard) is in the backlog.
- **Syncfusion key — not a credential.** It's a license-validation string (can't access data/accounts), still a hardcoded fallback in source + in git history (commit `991b1e2e`). Lower priority, OUR-side cleanup only (move to env, then drop the fallback, optionally scrub history). No owner action needed. STILL PENDING.

### 2. Test the renderer spike
Isaiah runs the dev server, opens `?spike=renderer`, loads his heaviest sheet, zooms to 400%/1600%. Record the verdict in `src/prototype/NOTES.md`. If pdf.js stays crisp+smooth → commit to the pdf.js path. If it blurs/janks → wire Arm B (EmbedPDF: `npm i @embedpdf/core @embedpdf/engines`) for the head-to-head.

### 3. Finish the annotation-data-loss fix (needs owner verification)
Wire `reindexAnnotationModel` into each `usePageOperations` handler so annotations follow page moves. **Risk**: the wiring must land the reindexed state into the refs the pdfFile-change hydration effect (`PDFViewer.jsx` ~16461) captures as "previous" — timing/effect-ordering sensitive, only validatable by running the app. Verify by deleting a page on a THROWAWAY copy and confirming annotations follow. Local files also need a stable id (today `getPDFId` = name+size → wipes annotations on any page op); that touches shared identity, do it carefully. Duplicate/paste copying annotations onto the new page is a flagged follow-up (needs marker/callout id regeneration).

### 4. Audit backlog (`.planning/AUDIT-2026-05-29.md`, ranked)
Excel two-way sync last-write-wins clobber → add change-conflict guard (live verify); MS Graph tokens plaintext at rest → encrypt; CRDT callout delete authority client-side-only → server guard; survey-marker cascade-delete suppressor; then big owner-tested milestones: pdf.js 3→5, Electron upgrade, the stamp tool (renders nothing — decide scope).

### 5. Standing/older threads
- Keyboard copy/cut for annotations (Command+C/X) were never wired — small feature, needs the selection layer (deferred).
- Browser-level workflow tests — Isaiah asked; none exist today; worth adding to catch page-op/annotation regressions.
- Continue the viewer break-up (history/undo or Excel-sync concerns next, per the coupling map).

---

## Warnings / invariants (unchanged)
- NO-GO in the viewer: the Syncfusion zoom/scale lifecycle and the per-page overlay portal loop. The four CLAUDE.md invariants are law (container-aware canvas sizing; SVG viewBox owns zoom; never remove the zoom-generation signal; single-name Fabric fonts).
- Every viewer edit is gated: `node scripts/check-undef.mjs` set-diff (zero new unresolved) + `vite build` + `npm test` (currently **840 pass / 0 fail / 6 skip**). One concern → one commit. Don't push without Isaiah's say-so.

## Resume
1. `git status` (expect clean) + `npm test` (expect 840/0/6). If not green, stop and investigate.
2. Read `.planning/AUDIT-2026-05-29.md` + this file.
3. Recommend to Isaiah: do the three credential rotations, then test the renderer spike, then finish + verify the annotation fix.
