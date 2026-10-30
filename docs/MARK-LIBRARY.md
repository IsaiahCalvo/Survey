# Mark library (Survey Nightly, beta)

Owner ask 2026-10-27: "Build the symbols thing in Nightly ... for single users,
for multi-user collaboration." This is Survey's take on Drawboard Projects'
Markup Library. It lives behind the beta flag `mark-library` (stage `beta`), so
it only ever shows on Survey Nightly. The old rule "no Symbols tool" still holds
on stable.

## What a person can do

- **Save** any picked marks: right-click → *Save to library*. Name it, pick the
  library (Personal, or the project's when you may add to it), add tags. *Save
  as → Replace "x"* puts the marks into an item you already have (Drawboard's
  edit flow: place it, change it, save it again).
- **Place**: click an item, then click the page (Shift-click keeps it picked for
  more drops; Esc lets go). Or drag the item onto the page. A finger tap places
  it in the middle of the page in view (touch never draws). The tile menu also
  has *Place in the middle of the page*.
- **Find**: search, tag chips, sort (recently used, name, newest), group by
  tag, large / small / list layouts.
- **Look after**: rename, tags (one or many), duplicate, move or copy between
  Personal and Project, export, delete (Undo toast), select mode for bulk work.
- **Share by file**: export one, some or all items to `.surveymarks` and import
  them into either library.

## How a placement works

An item's payload is the app's family clipboard (`buildFamilyClipboard`), and a
placement runs `commitFamilyPaste`, the same path as Ctrl+V. So:

- one placement = one save and one Undo;
- the marks are new marks, owned by whoever placed them;
- they take the landing scope: the open module, region, layer and space.

On the way in, `planLibraryPlacement` centres the item on the drop point and
keeps it on the page, `fitPlacedTextBoxes` grows text boxes whose tokens filled
in longer, and measurements take the landing page's scale.

## Mark kinds

Everything you can pick is allowed except text markup (highlight, underline,
strikeout), which belongs to the words under it. That covers shapes, ink, text,
callouts, counters, measurements, images and stamps (an item is capped near
1 MB), and Survey Markers.

## Surveys and spaces

- **Surveys**: a Survey Marker in an item becomes a new survey item in the open
  module's category with the same name, like a paste. No library entries live
  inside a survey template.
- **Spaces**: no separate library per space. A placed item joins the active
  space or region like any paste. A library is a source of marks, not a place.

## Text tokens

Text in an item may hold `{{tokens}}`. They fill in when the item is placed.

| Token | Fills in |
| --- | --- |
| `{{author.name}}` | Your name |
| `{{author.first_name}}` | Your first name |
| `{{author.last_name}}` | Your last name |
| `{{author.initials}}` | Your initials |
| `{{author.email}}` | Your email |
| `{{date}}` | Today's date (`{{date \| formatDate: "YYYY-MM-DD"}}` picks a format) |
| `{{time}}` | The time now |
| `{{document.name}}` | Document name |
| `{{project.name}}` | Project name |
| `{{page.number}}` | Page number |

`formatDate` takes moment-style parts: `YYYY YY MMMM MMM MM M DD D dddd ddd HH
H hh h mm A a`, with `[text]` kept as written.

## Who may do what

Table `public.mark_library_items` (migration `20261027233000_mark_library.sql`):

| Library | Read and place | Add | Rename, tag, replace, delete |
| --- | --- | --- | --- |
| Personal | only you | you | you |
| Project | viewer and up | editor and up | the author while still an editor, or a project owner |

Every rule goes through `user_can_access_project`. A trigger keeps the author
(it can't be set or changed by hand), tidies names and tags and caps each
library at 2000 items. `mark_library_project_access(project_id)` tells the
panel what the person may do. Signed out, the personal library lives in this
browser only.

## Live updates

The store (`src/markLibrary/markLibraryStore.js`) listens on realtime
`postgres_changes`: adds and edits filtered to your items and the open
project's; deletes unfiltered, because realtime only sends a deleted row's id
(the store drops ids it doesn't hold).

## Files

- `src/markLibrary/markLibraryModel.js`: pure rules (payload, names, tags,
  sorting, tokens, placement plan, export file).
- `src/markLibrary/markLibraryStore.js`: data, permissions, realtime.
- `src/markLibrary/MarkLibraryPanel.jsx`: the left-rail panel.
- `src/markLibrary/MarkLibrarySaveDialog.jsx`: the save card.
- `src/markLibrary/markLibraryPlacement.js`, `MarkLibraryPlacementLayer.jsx`,
  `markLibraryViewer.js`: arming, dragging, the ghost and the drop.
- `src/markLibrary/markLibraryThumbnail.js`: tile pictures.
- Tests: `tests/markLibrary*.test.mjs`, `tests/e2e-signed-in/mark-library.spec.mjs`.

`src/utils/symbolLibrary.js` is untouched: it still only draws symbols saved
by the old tool.
