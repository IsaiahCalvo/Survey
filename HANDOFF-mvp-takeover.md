# HANDOFF — MVP TAKEOVER (2026-06-12)

**Mandate from Isaiah (verbatim intent):** "I'm done telling you what to do… You're intelligent enough to read whatever you have to read. See the application, understand what we want to build, where we're failing, where the gaps are. Be consistent with UI and UX and take over from here… start fixing shit… so I can release this MVP. I've been working on this project for over a year."

Translation into operating mode: DO NOT ask "what next." Read this file + the boards + the plans, pick the highest-MVP-value item, verify it live in the browser, fix forward, repeat. Surface only (a) completed work with eyewitness evidence, (b) genuine product decisions, (c) the blocker list below until cleared.

## MVP definition (locked by Isaiah's own decisions)

Target: enterprise M365/SharePoint shops (Schneider-Electric-class). Pitch: **"We integrate with your existing Microsoft 365 / SharePoint permissions and audit every Excel-origin change."** Core: PDF survey annotation (markers/regions/spaces/shapes/callouts) + two-way Excel sync + role-based collaboration (owner/editor/viewer) + history/restore/audit. Excel add-in, Syncfusion removal, full persistence rebuild = post-MVP (locked).

## State (2026-06-12 early AM)

- Branch: local `main` in /Users/isaiahcalvo/Documents/Projects/Active/Survey-BetaSafeS2, ~200 unpushed commits, gates green (build clean; 1625 tests / 1610 pass / 0 fail). NEVER push without Isaiah's word. Worktree `claude/dazzling-stonebraker-9d9a3f` synced to main.
- Fleet: every-2h OS timer, baton HANDOFF-loop.md, cap 5/6 used, Linear access BROKEN for fleet (pending-flips list in baton). Claim the baton lock before editing repo from a fleet-adjacent session.
- Linear: canonical board (KAL-254…KAL-314 era). MCP access works from interactive sessions only. Obsidian Survey board mirrors it.
- THE VERIFICATION RECIPE THAT WORKS (mandatory for any user-visible change): copy `.env`, `.env.local`, `agent-cli/lib/env.mjs` from main checkout into worktree; `npm run dev:ui -- --port 5199` background; playwright PLUGIN MCP tools only (NOT Kapture/Chrome-ext/Preview); open `http://localhost:5199/` ROOT (auto-login owner; `?testPdf=` route has no documentId — History dead there); test doc `clickable-link-test.pdf` (has harmless sweep residue). Synthetic keyboard quirks: Delete key in region edit doesn't register; text inputs need real-keystroke simulation for persistence-sensitive checks.
- Agent discipline (this week's scars): agents die mid-run ~30% of the time — ALWAYS verify their git state; resume the same agent via its id with "continue from where you stopped." Never trust "completed" without commits+gates. PDFViewer.jsx TDZ class: anything read by dep arrays/publish effects must be declared above its reader (two shipped crashes + two near-misses). Browser verification is the ONLY acceptable "done" claim for UI work.

## CATEGORY A — RELEASE BLOCKERS (data loss / trust)

1. ~~**Fabric annotations don't survive app reload**~~ **DISPROVEN 2026-06-17 — NOT REPRODUCIBLE; not the #1 item.** Live-tested against production on `clickable-link-test.pdf` across four scenarios: CRDT shape (fix20 harness `createRectangle`), a real freehand pen stroke (synthetic pointer events on the Fabric upper-canvas), the pre-existing callout, and a same-tick create-then-`location.reload()` race with zero flush window. ALL survived a full reload + reopen via `__fix20OpenDocumentById`; the subsequent delete also persisted. The `crdt_dual_write_queue` was empty throughout, so the "quarantined retry queue pins stale reads" hypothesis never applied. What IS real and almost certainly misled the 2026-06-12 sweep: on open, the in-app diagnostic caches read empty — `cloudRenderAnnotationsByPage_<pdfId>` localStorage is rewritten to 0 entries and `window.__ydocAnnotationCount` shows 0 — even though the durable data is intact and rehydrates correctly. So the "store reverts" observation was a lying diagnostic surface, not data loss. Remaining narrow, non-MVP-blocking question: the forced-write-failure → quarantine degraded path (test seams `window.__crdtForceLegacyFail` / `window.__crdtForceFailAnnoId`) was NOT exercised — if anyone fears degraded-mode loss, that's the only thing left to prove. Conclusion: normal owner persistence is reliable; this is not a release blocker.
2. **Shipped-but-unapplied migrations:** KAL-307 registration table+RPC, KAL-313 trash trigger+retention+`space_deleted` immutability — exist as files only; the app runs against PRODUCTION Supabase. Export is safe (registration failure is caught, warns, proceeds). Consequence: registration/immutability/sweep are dormant until applied. Path: verify on survey-test (blocked on keys) → Isaiah's go → apply to production.
3. ~~Unpushed commits~~ **CLEARED 2026-06-12: pushed to github.com/IsaiahCalvo/Survey (17c8d831..11409f80).** Keep pushing on Isaiah's cadence going forward — he authorized this push explicitly; future pushes still need his word unless he says otherwise.

## CATEGORY B — FLAGSHIP WAVE (Excel Security V1; epic KAL-305; PLAN-EXCEL-SECURITY-V1.md governs, Codex-approved)

Done: slice 0 matcher (KAL-306✓), slice 1 registration client+migration (KAL-307, In Progress — DB verification pending keys), slice 7 trash-all-types (KAL-313 — live-verified; cascade+standalone restores work). Remaining, in dependency order: **KAL-308 server-side validation+transactional apply (the big one)** → KAL-309 sync-state table → KAL-310 immutable audit journal → KAL-311 business-only gate (precondition KAL-292 unplaced-rows surface) → KAL-312 ACL stamping + token rotation → KAL-314 permission flip (gated on trash✓ — now unblocked!). M365 live chain (KAL-291) is human-gated: Azure portal change → work sign-in → in-app probe → live pull → Row-ID drain on scratch workbook → writeback flip decision.

## CATEGORY C — PRODUCT COMPLETENESS (MVP scope; UI/UX consistency = Isaiah's explicit care)

- **Viewer ↔ homepage design parity (KAL-294):** everything moves toward the homepage look (gold accents, tighter density). Slice it: toolbar/chrome → rails → panels/modals; screenshot-driven; this IS the "consistent UI/UX" he means. Gold checked-checkbox standard already decided; shared select-checkbox component (SELECT-MODE-AUDIT S4/S5) folds in here.
- **Print/export finalization (KAL-295):** blocked on 4 sub-choices (PRINT-EXPORT-STATE.md) — present recommendations in the decision round; KAL-7 governs scope (overlays excluded from normal export).
- **Imported-ink policy (KAL-91)** + the print-resurrects-erased-marks fix (fix regardless).
- **Stamp/image annotations (KAL-126):** in/out of MVP — decision round.
- **Dead-end buttons (KAL-82 S2):** rewire or remove 5 buttons — decision round.
- Cosmetics queue: history actor shows raw email for marker deletes; sweep residue on test doc; KAL-293 watcher EPERM noise.
- Recommend POST-MVP: callout unification (KAL-297 — works today, documented fork), DB hygiene KAL-280…289 (opportunistic only), region-math consolidation + idle-rAF cleanup (REGION-ARCHITECTURE-AUDIT).
- **SCOPE OVERRIDE (Isaiah, 2026-06-12): Syncfusion removal IS MVP SCOPE.** "Rip out Syncfusion and use something good or better" — engine choice is Claude's lead (the three ?spike= pdf.js demos are the proven foundation, not a mandate). This joins Category A/B as a third critical-path lane: plan via DEMO-PARITY-BLUEPRINT.md + HANDOFF-remove-legacy-engine.md, slice it (render parity → overlay/zoom contracts → save/sync paths → Syncfusion excision), grill+Codex-review the cutover plan before building.

## BLOCKERS — only Isaiah can clear (work through these FIRST)

1. **Azure portal 15-minute change** on app 0da81a9e-2b05-46ee-b826-5efc5114c765 (Mobile+desktop platform, http://localhost redirect, public client flows) + **work-account sign-in** → unlocks the entire M365 live chain and ultimately the writeback flip.
2. ~~Test-project keys~~ **CLEARED 2026-06-12: Isaiah authorized; keys fetched (CLI keychain go-keyring-base64 wrapper → sbp_ token); .env.test written (gitignored, BOTH checkouts).** KAL-307 registration: applied to survey-test, **8/8 integration scenarios PASS** after fixing unqualified pgcrypto calls (extensions.gen_random_bytes/digest — fixed in BOTH the migration file AND the apply script's inlined copy; those two must stay in sync or be deduped). KAL-313 + its prerequisite history-events migration also applied to survey-test; trigger + sweep deployed; immutability verified by source-read (Management API runs as postgres which is allowlisted for the sweep — authenticated-user block needs a supabase-js client test later). REMAINING: Isaiah's **production apply** go for these migrations.
3. **Push authorization** — back up the year of work (private repo; or his alternative).
4. **One batched decision round** (present with recommendations, 10 minutes): stamps in/out; print panel 4 choices; imported-ink policy; dead-end buttons; plus rulings he can rubber-stamp: callout-unification post-MVP, Syncfusion removal post-MVP.

## Standing rules (unchanged)

Plain English to Isaiah (no paths/code names; "Survey Marker" in full; ≤5 sentences). Direct-to-main, never push unprompted. Gate everything on build + node tests; browser-verify UI claims. Sub-agents fix, Isaiah tests outcomes, never blame-shift. Respect PLAN.md amendments + ANNOTATION-CONTRACT.md + blank-rowid AMENDMENTS. Production Supabase: read-only unless Isaiah explicitly authorizes a change. Log PSMM moments; keep Linear+board synced when access exists.

## Suggested attack order for the next session (after blockers round)

1. Fabric reload persistence (Category A1) — task chip exists; diagnose live with the recipe; targeted fix.
2. KAL-308 server validation (flagship keystone) in parallel as a worktree build.
3. KAL-294 UI parity slice 1 (toolbar/chrome toward homepage) — the visible-progress item that makes the app feel like one product.
4. Decision-round outputs → ticket the rulings → execute.
