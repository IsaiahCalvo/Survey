Written: 2026-05-15 13:45

# Handoff — Home Redesign: Projects roster, avatars, thumbnails, upload persistence

## Where things stand

The Survey Hub home redesign is BUILT and MERGED into `chrome-lift/right-rail`
(merge commit `33597725`). The new home (Documents / Projects / Templates tabs,
share popup, Manage Team modal, profile menu, restyled Settings) renders as the
app home, wired to real data via adapter handlers in the `Dashboard` component
of `src/App.jsx`. All new code lives in `src/home/`. Test baseline: 650 pass,
1 pre-existing unrelated fail, 6 skipped — run `npm test` after any change.

Dev preview (mock data, no auth): `http://localhost:5180/?hubPreview=1`. The
real app is `http://localhost:5180/`.

## Remaining work (this handoff)

The user tested the live Projects tab with one real project and found:

1. **Roster must always include the owner.** A real project with no added
   teammates still has an owner — the user who created it. The roster panel
   currently shows EMPTY. Every project must show at least one roster member:
   the owner. When a project is created it should automatically have a
   one-person roster (the creator as owner); the owner can add more later.

2. **No fake/mock people.** The user deleted the sample teammates. Do NOT
   reintroduce mock people. The roster must come from real data — the project
   owner (current user) plus any real collaborators only.

3. **"Last edited by" shows no avatar.** In the open project's file list, the
   "last edited by" column does not render the owner's avatar glyph. Wire it to
   the real user.

4. **Left project-list rows show no avatar.** Each project row in the left list
   should show the owner's avatar glyph (today it shows nothing / a blank
   stack because `members` is empty).

5. **PDF thumbnail previews missing.** Files do not show a PDF thumbnail
   preview — notably in the preview section. Wire real PDF page thumbnails
   (the app already renders PDF pages elsewhere — reuse that).

6. **Uploaded files do not persist in a project.** Uploading a file to a
   project does not keep it in that project after switching tabs. The upload
   must actually save the file into the project (real `project_id`) and
   persist to Supabase, so it survives tab switches and reloads.

## Where to work

- `src/home/ProjectsFolderTree.jsx` — roster panel, left-list avatars,
  "last edited by" column.
- `src/home/DocumentsLedger.jsx` — preview-pane thumbnail.
- `src/App.jsx` — the `Dashboard` component's adapter handlers wire the hub.
  `members` is currently passed as `[]`; instead derive the roster from the
  real project owner (the signed-in user) + any real collaborators. The
  upload handler (`handleUploadClick` / the hub's `onUpload`) must attach the
  file to the active project and persist it.
- Project/document persistence: `src/hooks/useDatabase.js` (`useProjects`,
  `useDocuments`) and the Supabase `documents` / `projects` tables. Projects
  exist both locally and in Supabase — confirm the upload path writes the
  `project_id` so the file lives in the project.

## Key facts for whoever picks this up

- The hub's components already render avatars/rosters when given member data —
  the gap is that App.jsx passes no real owner/roster. Build the roster from
  the project's owner (the `user_id` on the project row → the signed-in user).
- Real project shape: `{ id, name, user_id, created_at }`. There is no
  members table for projects yet; the owner is `user_id`. Adding more
  teammates later is a separate feature.
- Real document shape: `{ id, name, file_size, project_id, created_at,
  updated_at, shared }`. No `owner` field today — "last edited by" should use
  the document's owner/user if present, else the project owner.
- After changes: `npm test` (expect 650/1/6), and load `http://localhost:5180/`
  to confirm the app builds and the Projects tab shows the owner roster.
