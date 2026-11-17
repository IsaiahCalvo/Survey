# Kal Voe suite rules

Walkthru, Plot and Survey are one suite. Many Claude sessions build in these
three repos at once, from different projects, and they can't see each other.
This file is how they stay in step. The same text sits at
`docs/suite/SUITE-RULES.md` in all three repos. Change it in all three in the
same round, or not at all.

Last checked against the code: 2026-11-16.

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
8. **Then archive it.** Once a ticket is Done and its work is merged, archive
   it in Linear (archive, never delete). Linear's free plan caps open tickets.

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

## One look for every control

Owner, 2026-11-16: hover, press, drag and drop must look and act the same in
all three apps (KAL-657). The colours come from the colour set below
(KAL-663). The steps, the timing and the cursors below are the same
everywhere. A control that skips a step is a bug.

### The states

| State | When | Look | Cursor |
| --- | --- | --- | --- |
| Rest | Nothing is happening. | The control's own fill. | `default` |
| Hover | A mouse is over it. Never on touch. | One step lighter than rest on a dark app, one step darker on a light app. Always the app's one hover colour. | `pointer` on anything you can click, `text` in a field, `grab` on anything you can drag |
| Pressed | Mouse down, or a finger down. | Dark app: darker than rest. Light app: darker than hover. It must never look the same as hover. | same as hover |
| Released | Mouse up. | Back to hover if the mouse is still over it, else to rest. The click runs on mouse up, not on mouse down. Letting go off the control cancels the click. | same as hover |
| Selected | It is the chosen tab, row or tool. | The app's one selected fill. Hover does not repaint it. A press still shows. | `default` |
| Keyboard focus | Reached with Tab. | A 2px ring, on `:focus-visible` only. Never on a mouse click. | no change |
| Disabled | It can't be used now. | Dimmed ink. No hover, no press. | `not-allowed` |
| Busy | The app is working on it. | A spinner in or beside the control. The control keeps its size. | `progress` |

- A coloured button (the main blue or coral one, a red delete) has its own
  three steps: rest, hover, pressed. It never falls back to the grey ones.
- A colour swatch never gets a hover or pressed fill over it. Its colour is
  the user's choice. Give it a ring instead.
- One hover colour and one pressed colour per app. No one-off hex colours in
  a component.

### Timing

| What | Time | Curve |
| --- | --- | --- |
| Hover in, hover out, pressed back to hover, selected | 150ms | ease out |
| Pressed, on mouse down | at once | none |
| A dragged item's neighbours opening a gap, and the dropped item settling | 200ms | ease out |
| Tooltip | waits once, then the next ones show at once | none |

Ease out is `cubic-bezier(0.33, 1, 0.68, 1)`. "Reduce motion" in the system
settings sets every one of these to 0.

### Drag and drop

1. **Can be dragged:** the cursor is `grab` on the item or on its handle.
2. **Picked up:** the cursor is `grabbing` for the whole drag, over anything.
   The item lifts: one solid fill edge to edge (the app's selected fill), a
   soft shadow, 6px corners. No see-through copy, no dashed outline, no ring,
   no scale. Its text stays where it was.
3. **Moving in a list, a tab row or a grid:** the items it passes slide apart
   to open the gap it will land in. No drop line.
4. **Over something that takes it** (a folder, a file drop area): that target
   shows the selected fill and a 2px accent outline, and nothing else changes.
5. **Over something that can't take it:** no change on that thing, and the
   cursor is `not-allowed`.
6. **Dropped:** the item glides into its gap. It never jumps.
7. **Cancelled** (Escape, or dropped where it can't go): the item glides back
   to where it started.
8. Dragging near an edge of a list that scrolls, scrolls it.

Things on the plan itself (a Node, a Block, a Survey Marker, a drawn mark)
follow steps 1 and 2 for the cursor, then move with the pointer with no lift.

### Where each app keeps it

| | Survey | Walkthru | Plot |
| --- | --- | --- | --- |
| Hover | `--hover` | `--state-hover` (a light tint, so it works over any fill) | `--fill` |
| Pressed | `--pressed` | `--state-pressed` (a dark tint, for the same reason) | `--pressed` |
| Selected | `--surface-3` | `--accent-bg` | `--accent-wash` |
| Coloured button: hover, pressed | `--accent-light`, `--accent-press` | `--accent-hover`, `--accent-pressed` (coral); `--ink-hover`, `--ink-pressed` (light); `--danger-hover`, `--danger-pressed` (red) | `--accent-hover`, `--accent-press` (coral); `--error-hover`, `--error-press` (red) |
| Focus ring | `--focus`, 2px | `--focus`, 2px; `src/lib/focus-ring-source.ts` | `--focus-ring`, 2px |
| State time | `--motion-state` | `--motion-state`, `--ease-state` | `--motion-state` |
| Drag | `--drag-lift-*`, `--motion-drag`, `src/reorder/dragMotion.js` | `--drag-lift-*`, `--motion-drag`, `[data-drag-lifted]`; `src/lib/drag-motion.ts` | `--drag-lift-*`, `--drop-outline`, `--motion-drag` |
| Files | `src/styles/tokens.css`, `src/styles/states.css` | `apps/web/src/app/globals.css` | `src/styles/tokens.css`, `src/styles/states.css`, `DESIGN.md` |

Survey has the full set today and is the one to copy the behaviour from.
"To add" means the app has no shared colour or rule for it yet: add one
token, then use it everywhere. When an app adds one, fill it in here.

## One colour set: grey and coral, light and dark

Owner, 2026-11-16: all three apps wear Walkthru's grey and coral (KAL-663).
Every app has a light mode and a dark mode. Coral is the one accent. Plot's
blue and Survey's blue and gold are gone from the chrome, and from every
logo, app icon, tab icon, loading mark and email. Green is never an accent
(it is Drawboard's colour). It may only say "done" or "synced".

The dark values are Walkthru's own. The light values are Plot's own greys
with a deeper coral, because the bright coral is too pale to read on white.

### The colours

| Name | Job | Dark | Light |
| --- | --- | --- | --- |
| ground | Behind everything, and round the page | `#131315` | `#f4f4f6` |
| panel | Bars, rails, sheets, cards, dialogs | `#1c1c1e` | `#ffffff` |
| raised | A field, a well, a menu, a raised card | `#242426` | `#f5f5f5` |
| raised-2 | One step past raised | `#2c2c2f` | `#ebebeb` |
| pressed-2 | Press on a control that rests on raised, such as a grey button | `#131315` | `#e0e0e0` |
| line | A thin line between things | `#2c2c2f` | `#ececec` |
| line-strong | A frame, a firmer divider | `#3f3f43` | `#d4d4d4` |
| edge | The only thing that shows a control is there (an empty field, a ghost button, a checkbox) | `#737378` | `#8a8a8f` |
| text | Headings, the row you are reading | `#e8e7e2` | `#131313` |
| text-2 | Body | `#d2d1cc` | `#4b4b4b` |
| text-3 | Captions, quiet icons | `#9a9a97` | `#666666` |
| text-off | Disabled. Too faint to read, on purpose | `#5c5c5a` | `#a3a3a3` |
| coral | The accent: main button, an ON switch, a chosen icon, a link | `#e07a5e` | `#ba4f2c` |
| coral-hover | Hover on a coral button | `#e89179` | `#a64525` |
| coral-pressed | Press on a coral button | `#c7634a` | `#8f3a1e` |
| on-coral | Words and icons on a coral fill | `#131315` | `#ffffff` |
| coral-wash | A soft coral tint: coral at 15% (dark), 10% (light) | `#e07a5e26` | `#ba4f2c1a` |
| danger | A delete icon, a red fill | `#ef4444` | `#d92d20` |
| danger-text | The word "Delete" | `#f87171` | `#b42318` |
| ok | Done, synced. A dot or a tick, never a button | `#8baa6e` | `#1f7a4d` |
| warn | A caution | `#d4a54a` | `#9a5b00` |

Hover and pressed fills come from the states table above: hover is `raised`
on a panel; pressed is `ground` in dark and `raised-2` in light. A control
that already rests on `raised` (a grey button) hovers to `raised-2` and
presses to `pressed-2`, so a press never matches its hover.

Checked for contrast (WCAG 2.1). Text, text-2 and text-3 pass 4.5:1 on
ground, panel, raised and raised-2 in both modes. Coral passes 4.5:1 as
words on ground, panel and raised. On-coral passes 4.5:1 on coral,
coral-hover and coral-pressed. Edge passes 3:1 on ground, panel and raised.
Line and line-strong are below 3:1 on purpose: they never stand alone.

- White words on the bright coral (`#e07a5e`) measure 2.9:1 and are not
  allowed. In dark mode a coral button has dark words. In light mode the
  coral is deeper and the words are white.
- Coral words on raised-2 measure 4.2:1 in light mode. Put a coral link or
  a chosen icon on ground, panel or raised, not on raised-2.
- Coral and danger sit close. Never put a coral button beside a red one
  without a word on each.
- No app adds a grey or a coral of its own. Need a new step? Add it here
  first, in all three repos.

### What the theme never paints

- The paper a page, a thumbnail or a print preview is drawn on.
- Ink the user picked: mark colours, swatches, Category colours, Node and
  Block colours.
- Selection handles and the marquee on the plan. They stay blue
  (`#4a90e2`), so they stand off coral marks and red clouds.
- Other makers' logos (Microsoft, Google, Apple).
- A person's own colour (live cursors, avatars).

### Light and dark

- Each app has one setting, **Appearance**: Light, Dark, or Match system.
  It is saved on the device, not on the account.
- Until the user picks: Survey and Walkthru open dark, Plot opens light, as
  they did before.
- The choice sits on `<html>` as `data-theme="light"` or
  `data-theme="dark"`, with `color-scheme` set to match. Colour names take
  their values from that one attribute. A component never asks which mode
  it is in.
- The mode is set before the first paint, so the app never flashes the
  wrong one.
- Shadows are lighter in light mode. A floating thing in light mode also
  takes a `line` hairline, since a shadow alone is weak on white.
- Every screen is checked on screen in both modes before it ships.

### One font

Geist for every word in the chrome, Geist Mono for numbers that line up.
Walkthru and Plot have it. Survey has it under the Nightly flag `one-look`
(KAL-663, PR 1512).
Words drawn on a page keep the font their mark picked.

### Where each app keeps the colours

| Name | Survey | Walkthru | Plot |
| --- | --- | --- | --- |
| ground | `--surface-0`, `--surface-1` | `--bg-canvas-deep`, `--paper-deep` | `--desk` |
| panel | `--surface-2`, `--panel-bg` | `--bg-canvas`, `--bg-elev-1`, `--paper` | `--chrome`, `--panel` |
| raised | `--hover` (raised-2 is `--surface-3`) | `--bg-elev-2` (raised-2 is `--bg-elev-3`) | `--fill` |
| line, line-strong | `--border` | `--border-1`, `--border-2`, `--rule`, `--rule-strong` | `--hairline-mid`, `--hairline-strong` |
| edge | `--border-strong` | `--edge` | `--edge` |
| text, text-2, text-3 | `--text-1`, `--text-2`, `--text-3` | `--text-primary`, `--text-secondary`, `--text-muted`, `--ink`, `--ink-soft`, `--ink-muted` | `--ink`, `--ink-body`, `--ink-muted` |
| text-off | `--text-disabled` | `--text-off` | `--ink-off` |
| coral | `--accent` | `--accent` | `--accent` |
| on-coral | `--accent-text` | `--on-accent` | `--ink-inverse` |
| danger | `--danger`, `--danger-text` | `--destructive`, `--danger-text`; words on a red fill `--on-destructive` | `--error`, `--error-text` |
| ok, warn | `--success`, `--warning` | `--ok`, `--warn` | `--ok`, `--warn` |
| scrim, floating shadow | to add | `--scrim`; `--shadow-float` with `--float-hairline` | to add |
| Files | `src/styles/tokens.css`, `src/suiteLook.js` | `apps/web/src/app/globals.css` | `src/styles/tokens.css` |

Survey and Walkthru show the new colours and the light mode in Nightly
first. When an app fills a "to add" cell, or its theme ships, write it here.

Survey: built (KAL-663, PR 1505). The look sits behind the Nightly flag
`one-look`. Appearance is in Settings, General. Emails and the sign-in
emails wear grey and coral for everyone (PR 1510).

Walkthru: built (KAL-663, PR 218). Light mode sits on
`html[data-theme="light"]`. Appearance is in Settings, behind the Nightly
flag `appearance`, saved in `walkthrough.appearance`. The first-paint script
comes from `apps/web/src/lib/appearance.ts`.

Plot: built and shipped, no flag (KAL-663, PR 420). Plot opens light until
the user picks.

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
