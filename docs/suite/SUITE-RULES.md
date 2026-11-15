# Kal Voe suite rules

Walkthru, Plot and Survey are one suite. Many Claude sessions build in these
three repos at once, from different projects, and they can't see each other.
This file is how they stay in step. The same text sits at
`docs/suite/SUITE-RULES.md` in all three repos. Change it in all three in the
same round, or not at all.

Last checked against the code: 2026-11-15.

## Before you build anything

Do these in order, every time.

1. **Find the ticket.** All work is a Linear ticket on team Kal Voe (`KAL`),
   in the app's own project (Survey, Walkthru or Plot). Work that touches two
   or more apps goes in project Kal Voe Suite. No ticket? Make one first.
2. **Check nobody has it.** Look at the ticket's status and assignee. Then look
   for open PRs and branches that name the ticket id (for example `KAL-587`).
   If it is In Progress or In Review, or a PR already exists, stop. Don't
   build it a second time. Say so in your thread instead.
3. **Claim it.** Set it to In Progress and put the ticket id in your branch
   name or PR title. Now it is yours. One ticket has one owner.
4. **Start from the newest code.** Fetch the default branch (table below) and
   branch from it. Read what merged since the ticket was written
   (`git log`), so you don't redo or undo it.
5. **Stay in your lane.** Don't change files another open ticket is changing.
   If you must, say so on that ticket first.
6. **Before you merge,** rebase on the newest default branch again and re-run
   the checks.
7. **When done,** comment on the ticket with the PR link and move it on.
   Code written is not Done: tests and checks must pass first.

| Repo | Default branch | Checks |
| --- | --- | --- |
| Survey | `main` | GitHub checks run. Merging to `main` also pushes new database migrations to the live database on the next production deploy. |
| Walkthru | `master` | GitHub's own checks do not start in this repo. Run `npm run verify` yourself before merging. |
| Plot | `claude/gallant-brahmagupta-12ilw6` | `main` is stale (since 2026-09-30). PRs target the live branch. |

## Where the plan lives

- Spec: Linear KAL-584 ("one suite from Walkthru to Plot to Survey").
- Map and decisions: KAL-549, with decisions on KAL-550 to KAL-575.
- Build tickets: KAL-585 to KAL-597.
- First hand-off to build and prove: Walkthru to Survey, on the Collier NYC
  walk (KAL-594 to KAL-597).

## Standing rules

- Each app can be bought and used alone. Every app works offline and syncs
  later.
- Suite parts in Survey and Walkthru sit behind the `suite` beta flag, shown
  only in Nightly. Plot needs no flag.
- Database changes that add things are fine. Never lose customer data.
- Use each app's real words (below). Matching is plain rules, never a best
  guess: library id first, else an exact name the user confirms.

## Shared words

| Walkthru | Plot | Survey | Meaning |
| --- | --- | --- | --- |
| Company, My library, Company library | same | same | The account a team shares, and its shared list of Categories. |
| Template | Template | Template, Module | A reusable set of Categories. Module is Survey only. |
| Category, Category Type | same | same | A kind of thing (Camera), and an optional kind under it (PTZ). Walkthru's old "Node type" is Category. |
| Node | Block | Survey Marker | Anything dropped on the plan. Never "Pin" in Walkthru. |
| Default node | Block with no Category | none | Stays in its own app. Doesn't travel. |
| Tag | Tag | Tag | The device's name, such as C-1-01. |
| Annotation | Annotation | Annotation | Drawn marks that aren't devices. |
| Page | Page | Page | One page of a drawing. |
| Building, Wing, Floor, Location | same | same | Where a device is. |
| Media | Media | Media | Photo, Video, Audio recording, Transcript, Note. |
| | Schedule, Riser | Schedule, Riser (read only) | Made in Plot, read elsewhere. |

App-only words: Keynote, Typical, Layout (Plot). Module, Checklist Item,
Entity, Counter Pin, Labels, Paper (Survey). Each app's `CONTEXT.md` has its
full list and the old code names.

## One device, one shared id

A Node, Block or Survey Marker **with a Category** is a tracked device. It
carries a shared id, its Tag, and Building, Wing, Floor and Location from app
to app.

The shared id:
- is the item's own id the first time an app makes it a tracked device;
- never changes;
- is kept by every copy, duplicate and import, so one real camera never
  splits into two;
- is never written by an Excel import.

| | Shared id | Building, Wing, Floor, Location | Library link | State |
| --- | --- | --- | --- | --- |
| Walkthru | `nodes.suite_device_id`, set by a database trigger the first time a node has a Category | Building, Wing and Floor are set per page in `page_locations` and copied onto `nodes.building`, `nodes.wing`, `nodes.floor_label`. Location is per node: `nodes.location`. Apps can't write the copied ones. | Not yet (KAL-593) | Merged (PR 166, KAL-587). The Walkthru tables are also copied into Survey's database under the `walkthru` schema (KAL-579). Check which project the app points at before a database change. |
| Survey | `suiteId` on the marker record (live-editing doc and `annotation_data`). Old markers fall back to their own id. Code: `src/survey/suiteMarkerFields.js` | `building`, `wing`, `floor`, `location` on the marker | `libraryEntryId`, `libraryTypeEntryId`. Library table: `library_entries` | Merged (PR 1463, KAL-585, KAL-588). The library table goes live with Survey's next production deploy. |
| Plot | `Device.suiteId` in the `.plt` file | `Sheet.building`, `Sheet.buildingFloor` (already there), plus new `Sheet.wing` and `Device.wing` | `Category.libraryEntryId`, `Block.libraryEntryId` | Being built (KAL-589). Plot's parser drops fields it doesn't know, so it must learn these before any import writes them. |

## Hand-offs

- One shared database: Survey's Supabase Pro project. Survey is the sign-in
  server for the suite.
- Inside the shared database, a hand-off writes straight into the Project.
  The `.kvjob` file (`package.json`, `pages/*.pdf`, `media/*`,
  `library.json`) is for offline moves and for Plot until it joins.
- **Walkthru to Survey:** the user picks the Template and Module once. A
  linked Category in that Module gets the device as a Survey Marker (a dot
  where sales dropped it) with its checklist. A Category missing from the
  Module is listed under "Not in this Module" and counted, never dropped.
  Default nodes stay in the Walkthru tab of the Project.
- **Plot owns** each device's Tag and spot. Field changes come back to Plot as
  suggestions the designer accepts or rejects.
