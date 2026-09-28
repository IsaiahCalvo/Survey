Written: 2026-09-28 14:45

# History panel + undo/redo: audit and redesign proposal (w55, phase 1)

Status: PROPOSAL. Nothing is built. The owner picks an option, then phase 2 builds it.
Branch: `claude/w55-history-audit` (off local main `bb041ea39`).

## 1. What the pro apps do (research summary)

| App | What matters for us |
|---|---|
| Figma | Right-side version list; autosaves fold into groups; named versions stand out; click = read-only preview on the canvas; restore keeps the current state as a new entry. No single-item restore (users copy/paste from old versions). |
| Google Docs | Edits grouped into time blocks you expand; "Highlight changes" colors each editor's additions, strikes deletions; arrows step to next/previous change; one-click restore of the whole doc, or "Make a copy". |
| Bluebeam Revu | Markups List: one row per markup, columns (type, page, author, date, status), group/sort by page or type, filters, arrow keys step through markups, click jumps to the markup. Studio "Record" log: tool icon + person + description per row; deleted items get a delete icon. |
| Acrobat | Comments list sorted by page by default; filter by person/type/status/color (filter also hides on the page); click jumps to the comment. |
| Drawboard Projects | Project-wide activity feed: who added each markup and when; every item links straight to the drawing. |
| Miro | History panel with Activity and Versions tabs; a deleted object has its own Restore button, comes back in place and the board zooms to it. Version restore always makes a separate board. |
| Notion | Split view: old page preview left, timeline right; restore is itself undoable; trash keeps items 30 days. |
| Autodesk Docs/ACC | Markups are private until published; panel filters published/unpublished; admin activity log for audit. |

Recurring standard: the document stays visible beside the list; each row = tool icon + verb + object + who + when (+ page); busy stretches collapse; filter by person and kind; click takes you to the mark; looking never changes anything, only an explicit Restore does; restore is undoable; a deleted item restores on its own, in place, with the view moved to it; viewers can look but not restore.
Anti-patterns: whole-document restore as the only way back; restore that overwrites with no way back; a flat noisy log with no grouping, filter, or navigation.

## 2. Audit: defects (ranked)

Evidence: two adversarial Opus code reviews + a live run on port 5288 with one throwaway 3-page document (deleted after). LIVE = reproduced in the running app.

### High
1. **Restore on a mark that is already back silently throws away every later edit.** `PDFViewer.jsx:27207-27223` + `annotationLocalHistory.js:~1058-1072` (the "already present" check can never fire; the apply always returns a new object). Same in the bulk branch (`27153-27157`). LIVE: delete ellipse, Cmd+Z, resize it (width 147 to 52), press Restore on the delete row: it snaps back to width 147, message "Restored deleted item". The Restore button never goes away after use.
2. **Survey Marker restore overwrites a live marker**: answers, name, notes go back to delete-time values and its Excel "exported" flag is cleared, so it counts as unsynced again. `surveyMarkerHistory.js:109-120`, `PDFViewer.jsx:27016-27024`. No "already present" check, no undo step.
3. **Named versions do not work.** Save records "0 annotation(s)"; Restore says "Restored vN" but the page does not change; "Open read-only" shows today's marks with a banner. They read/write the old `document_annotations` table the viewer no longer uses (`kal48_inline_auth_checks.sql:142, 290-304`; `RevisionsPanel.jsx:297-312` never draws `snapshot_json`). LIVE: all three.
4. **Undo/redo rows show "deleted" and a working Restore button.** `isDeleteHistoryEvent` matches the text "delete" in `rawActionType` (`RevisionsPanel.jsx:95-102`). LIVE: "Isaiah Calvo undid an edit · deleted · Restorable deleted item [Restore]"; pressing it reports success (and hits defect 1).
5. **Survey Marker delete rows are not protected**: `survey_marker_deleted` is missing from the prune keep-list and the no-delete trigger list, so the nightly 60-day prune removes them and an owner can delete them. `20260925_w36_prune...sql:223-229`, `20260611130000_kal313...sql:50-56`.
6. **Deleted items older than the newest 200 rows are unreachable.** The panel loads only the newest 200 rows of any kind, no "load older" (`RevisionsPanel.jsx:212`). The database keeps delete rows forever, but after 200 later edits their Restore is gone, and the region "Restore both?" check wrongly says "no restore record".
7. **Cmd+Z skips edits on a teammate's mark and undoes your own older edit instead** (contributors can edit everything but those edits get no undo step). `annotationLocalHistory.js:961-969`, `PDFViewer.jsx:26098-26112, 26904-26916`. Adjacent to w54's edit-rights work: flag to w54, do not fix here.

### Medium
8. **Undo on another page changes it off-screen; the view never moves there.** Main undo lane (`applyLocalAnnotationHistoryAction`, `PDFViewer.jsx:~12946`, `13840-13900`) never navigates.
9. **The highlight shows where the mark was, not where it is.** Stored event-time geometry is tried before the live mark (`RevisionsPanel.jsx:697-698`). LIVE: rectangle resized; clicking its "created" row pulsed an empty spot.
10. **Viewers see Restore, and most restore types skip the edit-rights check** (only erase and spaces check). `RevisionsPanel.jsx:878-945`, `PDFViewer.jsx:27016-27061, 27139-27177, 27207-27222`.
11. **Bandwidth and storage.** Every 10 s the open panel re-downloads the whole list with full payloads. LIVE: 40 KB per read with ~25 rows, so ~400 KB per read at the 200-row cap (~140 MB/hour per open panel, against the Free plan's 5 GB egress). Delete rows skip the 12 KB trim. The local cache keeps 500 rows per document for every document ever opened, never pruned, not per signed-in user (LIVE: 1.4 MB for one document), and its rows can crowd real rows out of the 200.
12. **Bulk-delete toast "Undo" after Cmd+Z duplicates every mark**, and those duplicate ids then break undo for them. `PDFViewer.jsx:20404-20417`.
13. **Clicking a row applies the author's screen setup, not the mark's**: can close your survey panel or switch you into a module that hides the mark. `historyContextRestore.js:61-97`, `PDFViewer.jsx:27321-27370`.
14. **Panel can crash**: `useMemo` runs after `if (!documentId) return null` (`RevisionsPanel.jsx:786-788`); a document id going null to set throws React's hook-order error and takes the sidebar down.
15. **Late retries from an earlier click replace the next click's highlight** (6 x 250 ms, never cancelled). `RevisionsPanel.jsx:694-708`.

### Low
16. **Highlight never stops pulsing** and follows you into another open document (`RevisionsPanel.jsx:490, 603, 411-425`). LIVE: still pulsing after 10 s.
17. **Wording**: "created a ellipse"; ellipse delete says "deleted an annotation"; a resize is logged "moved"; a History restore is logged "moved"; raw ids ("Annotation: 440aba32-…") in the detail line; the person's name is frozen into the text at write time and is email for some types, full name for others.
18. **Gold misuse + keyboard**: selected row has a gold box and the page highlight is gold (owner rule: gold glyph only, no gold boxes); keyboard focus invisible (`outline: none`); no arrow-key stepping.
19. **Restore reports success when it did nothing** (space rights), and no restore writes a "restored by" row.
20. **Offline** shows an error instead of the cached rows (`documentHistoryService.js:384-386`).

Checked and fine: undo after a teammate edits the same mark reverts only your own change (LIVE, two screens); cross-page row click scrolls the page into view and highlights (LIVE, page 3, ~450 ms); document switch clears undo stacks; undo never resurrects a teammate's delete; deleting a document with delete-audit rows still works.
Not live-tested (needs survey/Excel setup): callout, Survey Marker, region and space restore; covered by code review only.

## 3. Options

All three share: left-rail History tab stays where it is; one panel with hairline rows (no cards); tool glyphs from the app's own icon set; selected row = gold glyph only; the on-page highlight uses the selection blue (#4a90e2), never gold; the view fits the mark (page + zoom so the mark fills ~40% of the view), a blue outline draws on, pulses twice, holds 2 s, fades; Esc or clicking the page clears it; Up/Down step rows and move the highlight; Restore is a glyph (counter-clockwise arrow) on hover/selected rows only, hidden for viewers, and is itself undoable.

### Option A: Activity feed (Miro/Figma style), recommended
- Rows grouped by day (Today, Yesterday, date). Back-to-back edits by one person on one mark fold into one row ("moved a rectangle · 4 edits"), expandable.
- Row: tool glyph, "**Isaiah** moved a rectangle", right-aligned page number; second line: person dot (their color) + relative time.
- Header: filter glyph (Everyone / Only me / Deletes), search glyph; "Load older" at the bottom, paged 50 at a time.
- Deleted rows: dimmed glyph with a strike; click shows a dashed ghost where it was; Restore glyph brings it back in place and the row turns into "restored by you".
- Named versions become a separate "Versions" toggle at the top, hidden until they work.

### Option B: Markups list (Bluebeam/Acrobat style)
- One row per mark as it is now, grouped by page (Page 1, Page 2, ... collapsible), then a "Deleted" group at the bottom.
- Row: tool glyph, mark name or type, last change + who + when. Expand a row to see that mark's own timeline (created, moved, recolored...).
- Click: page + fit + everything else on the page dims to 35% while the mark stays full strength.
- Best for "find a mark and see what happened to it"; weaker for "what changed today".

### Option C: Versions with change view (Google Docs style)
- Top toggle Activity | Versions. Activity is a lean version of A.
- Versions: sessions ("Isaiah, 2:10-2:40 PM, 12 changes") and named versions. Selecting one shows that moment read-only on the page with changes marked: added = author's color outline, removed = dashed ghost, moved = faint trail from old spot. Prev/next arrows step through changes.
- Restore whole version (current state saved first) or restore one mark from it.
- Most powerful, most work: needs real version snapshots from the live mark store (defect 3).

**Recommendation: A now, B's per-mark timeline as its expand view, C's Versions later** once defect 3 is fixed at the data level. A matches how people ask "what happened and who did it", fixes the noise and the missing grouping, and keeps single-item restore, which the research shows people value most.

## 4. Fix regardless of option

Defects 1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19; defect 3 either fixed at the data level or the Save version / Restore / Open read-only controls hidden until then; defect 7 handed to w54; defect 13 changed so a row restores only the mark's own space/module, never closes the viewer's panel.

## Acceptance criteria (phase 2)
- Given a mark that was deleted then brought back and edited, when I press Restore on its delete row, then nothing changes and I'm told it's already there.
- Given an undo row, then it shows no "deleted" tag and no Restore.
- Given 500 events, when I scroll to the bottom and press Load older, then older rows (including old deletes) load and can be restored.
- Given a moved mark, when I click its row, then the highlight lands on where it is now, in blue, and stops after ~3 s.
- Given a viewer, then no Restore control is shown.
- Given the History tab open for an hour, then it downloads only new rows, not the whole list every 10 s.

## DO NOT CHANGE
Always protected: `src/PDFViewer.jsx` (minimum diff), `src/viewerShared.js`, `src/PageAnnotationLayer.jsx`, `src/components/FabricEraserCanvas.jsx`, `src/components/SVGAnnotationLayer.jsx`, `package.json`, `vite.config.js`. Phase-specific: w54's edit/delete permission blocks, Lock, Survey Marker cut paths; the prod prune job settings (owner-applied).
