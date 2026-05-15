Written: 2026-05-15 15:35

# Handoff — Home Redesign: audit follow-ups + Templates editor bugs

## Where things stand

The Survey Hub home redesign (Documents / Projects / Templates tabs, profile
menu, Manage Team modal, restyled Settings) is built and live as the app home.
Work happens in the git worktree at
`.claude/worktrees/home-redesign` (branch `home-redesign`). Run the dev server
FROM THAT WORKTREE — the user's normal dev server watches the main repo folder
and will not show this work otherwise.

Test baseline: `npm test` → 650 pass, 1 pre-existing unrelated fail
(`annotationInitialHydrationSource`), 6 skipped. `npx vite build` succeeds
(only the pre-existing chunk-size warning). Run both after any change.

## Done this session (verified: tests green, build clean)

1. **Owner / team / avatars** — Projects tab now derives the project owner
   (the project row's `user_id`, falling back to the signed-in user) as a real
   one-person team. Avatars render real initials, not raw ids. The signed-in
   user's `id` is now passed into the hub (`SurveyHub` user prop in
   `src/App.jsx`).
2. **No fake people** — `ManageTeamModal.jsx` lost its hardcoded
   `DEFAULT_MEMBERS` / `ACTIVITY` mocks; it now shows the project's real team
   (the owner). Avatars show initials.
3. **Upload into a project persists** — root cause: App's
   `supabaseDocuments → parent` sync effect re-shaped each row and DROPPED
   `project_id` (kept only camelCase `projectId`); the hub groups files by
   `project_id`, so projects always looked empty. Fixed by spreading `...doc`
   first in that effect (`src/App.jsx` ~line 3162). Projects-tab "Add files" /
   "Upload files" now route through `handleUploadClick(projectId, { open:false })`
   — saved into the project, not opened.
4. **File delete in Projects persists** — `ProjectsFolderTree` `deleteFiles`
   now calls the real `onDeleteDocuments` (App's `hubDeleteDocuments`).
5. **PDF thumbnails** — `src/home/PdfPageThumb.jsx` rewritten: one high-res
   first-page render per doc (cached by id), byte-resolution faithful to
   App's `PDFThumbnail` (local File → dataUrl → storage download → public URL).
   Documents tab: preview pane variant + row variant; thumbnails have their own
   centered column with the "File" header over the name. Dark slate backdrop
   (`var(--ink-800)`), not white.
6. **"Roster" → "Team"** everywhere in the hub (labels, comments, the
   `projectTeam` helper).
7. **Keyboard-shortcuts hint pill** removed (`KeyboardShortcutsOverlay.jsx`
   renders nothing when closed; the `?` key still opens the list).
8. **Documents preview pane** — no longer scrolls: fixed-height flex column,
   preview at a set size (360px, can shrink), flexible gap, "Open file" + ⋯
   pinned at the bottom. Fake "Recent activity" removed. New section order
   under the preview: **Team** (always shows the owner), **Last edited** date,
   **Uploaded** date. Old "Collaborators" name dropped.

## Remaining work

### A. Templates editor bugs (user-reported — fix these first, one at a time)

All in `src/home/TemplatesEditor.jsx`. Fix one, have the user verify, then move
on (user preference: one fix one test).

1. **Border "match fill" does nothing to the border.** For an entity glyph,
   hitting "match fill" should set the glyph BORDER's color AND opacity to
   match the fill's color and opacity. Currently the border is visibly
   unchanged. Make match-fill actually copy fill color + fill opacity onto the
   border.
2. **Grabbers (drag-to-reorder) don't work / no drag animation.** The
   drag-to-rearrange grabbers in the entities list are broken — the reorder
   animation does not run. The user had this working in their ORIGINAL app —
   ask the user to point at that reference before guessing.
3. **Module tabs drag is unaesthetic.** After fixing the entity grabber (#2),
   match the module-tab drag-reorder to that same feel — but horizontal.
4. **Entity select-mode checkbox disappears when expanded.** In the entities
   list, when select mode is on and an entity row is EXPANDED, its checkbox
   vanishes. Keep the checkbox visible whether the entity is collapsed or
   expanded.

### B. Persistence gaps (front-end-only today — bigger, separate work)

From the fake-data audit. None of this is a deception bug — it was deferred
"this pass" — but the user wants it real:

- **Templates editor saves nothing.** Modules, categories, checklist items and
  entities all edit local React state only (`TemplatesEditor.jsx` header says
  so). Needs wiring to the templates backend.
- **Projects tab local-only actions:** duplicating / renaming / reordering /
  pinning a project, and duplicating / moving / copying / pasting files — none
  persist (do not survive a reload). Upload + file delete DO persist now.
- **Share popup** (`ShareModal.jsx`) is UI-only — copy-link gives a placeholder
  string, send-invite is a no-op.
- **Manage Team** invite + role changes do nothing real — there is no
  teammates table. The project owner is the only real member; a teammates
  feature is its own project.

### C. Not fake, just noted

`src/home/HubPreview.jsx` is a dev-only mock sandbox (route `?hubPreview=1`) —
it is never shown in the real app; leave it alone.

## Key facts

- Real project shape: `{ id, name, user_id, created_at }`. Owner = `user_id`.
- Real document shape: `{ id, name, file_size, project_id, created_at,
  updated_at, user_id, shared, page_count, file_path }`.
- The hub groups a project's files by `project_id` — anything feeding the hub
  `documents` MUST preserve `project_id` (see the App sync effect note above).
- High-risk file: `src/App.jsx` (~1.3MB) — minimum viable diffs only; standing
  waiver to edit it exists, still keep edits small and run `npm test` after.
