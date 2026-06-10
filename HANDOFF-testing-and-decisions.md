# Handoff: Isaiah's testing pass + queued decisions (START HERE with Isaiah present)

**Written:** 2026-06-10 ~13:00. **Branch:** main, local-only (~170 unpushed commits — push ONLY on Isaiah's say-so after testing).
**Loop state:** autonomous fleet runs every 2h via OS timer (see HANDOFF-loop.md baton). Code-change cap is 6/6 → fleet is TEST/AUDIT-ONLY until Isaiah confirms testing. No collision risk with interactive work as long as you respect the baton lock in HANDOFF-loop.md.

## 1. Isaiah's live-testing checklist (dev server: npm run dev:ui, port 5174)
- Place a Survey Marker; in the naming popup, clear/replace the suggested name — custom names must stick (BL-22 fix, e5321452).
- Home-screen Templates editor: rename a category, confirm typing survives a background refresh; empty title snaps back on blur (BL-23 fix, e2020f0e).
- Dashboard + region drawing smoke test (KAL-82 dead-code slices bb30c724 + 4a498f1f, BL-19 merges 5a9eced6/7d089184 touched region math + error handling).
- KNOWN dead-ends (not regressions, pre-existing): hub "New Template", viewer "Create Template" x2, rail create-category x2 do nothing visible — decision pending below.
- After a PASSING pass: tell the session "testing confirmed" → it must reset the baton cap line in HANDOFF-loop.md to "0 of 6" with a fresh note, which un-pauses the fleet's code work.
- If something FAILS: do NOT fix inline; file it (board + backlog) and either let the fleet take it or claim the baton lock first.

## 2. Decisions queued for Isaiah (answer in any order; relay each into the named ticket/file)
1. Select-mode (BL-17 / SELECT-MODE-AUDIT.md): (a) which checkbox style becomes the app-wide standard; (b) does team-member removal need a confirm; (c) delete or finish the never-wired survey-panel "copy mode".
2. Drag-and-drop (BL-18 / DND-CONSOLIDATION-AUDIT.md): (a)+(b) two visual-consistency values for drag affordances; (c) dead dashboard file-drop zone — wire it or delete it.
3. Dead-end buttons (KAL-82 slice 2, PLAN-KAL82-S2.md): rewire or remove the five buttons listed above; also whether their silent entities-reset side effect should survive.
4. Imported ink (KAL-91 / IMPORTED-INK-AUDIT.md): edits to imported PDF marks count as yours (recommended) vs read-only-until-unlocked. (Also: printing currently resurrects erased originals — fix queued regardless.)
5. Marker-name popup (BL-22 notes): Escape/click-outside silently keeps the suggested name and discards typing — keep or change.
6. Template edit conflicts (BL-23 notes): last-writer-wins stays, or build a real conflict prompt later.
7. Print/export (BL-21 file, 4 sub-choices): what it takes to enable the currently-disabled custom print panel.
8. Stamp/image annotations (KAL-126): in scope for v2.0 or not.
9. Smaller: empty-title rejection toast (BL-23); CI baseline migration for the test database (KAL-257 notes).

## 3. Also pending (unchanged from yesterday)
- M365: Azure portal one-time change → work sign-in → in-app "verify live sync" → live checklist → only then discuss flipping the writeback master gate (HANDOFF-excel-sync-next.md).
- Polish requests Isaiah mentioned ("polish the things you've done") — gather specifics from him at session start.
- Replicating the loop runner for Walkthru (~/Projects/Walkthru) and Takeoff (~/Documents/Takeoff) when he asks; EDC Calculators lives on his other PC.

## Rules for the next session
Plain English only to Isaiah (no paths/code names; "Survey Marker" in full). Don't re-open settled decisions (PLAN.md amendments, blank-rowid verdict doc AMENDMENTS). Respect the baton lock. Gate any change on build + node tests. Never push without his word.

## 4. New since writing (2026-06-10 ~13:20)
- Isaiah archived ALL closed Linear issues — workspace had free slots again.
- **DONE 2026-06-10**: BL-01…BL-23 fully migrated to Linear (KAL-280…KAL-297) by the interactive session; the ~14:07 loop session then verified + finished board hygiene: all attached to the Survey project, KAL-296 closed (was BL-22, fixed e5321452 and PASSED Isaiah's live test), KAL-295 set In Progress (was BL-21), Obsidian board files renamed to KAL names with fixed frontmatter, board index restructured, backlog file stamped historical with a BL→KAL mapping table. Linear is canonical again.
- Known UX limitation acknowledged to Isaiah: a session's phone-visible name is fixed at birth; multi-task sessions keep their first title until the next session is born.
