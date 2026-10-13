# Survey Home Design Source

This file captures the product design language from the Survey home page only.
Its purpose is to let the PDF viewer and mobile app adapt toward the home page,
not the other way around.

## Source Boundary

Use only these home-page sources as design input:

- `src/home/SurveyHub.jsx`
- `src/home/HubShell.jsx`
- `src/home/hub.css`
- `src/home/DocumentsLedger.jsx`
- `src/home/ProjectsFolderTree.jsx`
- `src/home/TemplatesEditor.jsx`
- `src/home/PdfPageThumb.jsx`
- `src/home/ShareModal.jsx`
- `src/home/AccessManagementModal.jsx`
- `src/home/BulkModals.jsx`
- `src/home/ManageTeamModal.jsx`
- `src/home/HubPreview.jsx`

Do not use these as design input for this file:

- `src/PDFViewer.jsx`
- viewer rails, PDF toolbars, PDF sidebars, PDF overlays, PDF canvas behavior
- `mobile-expo`, `mobile-expo-go`, Capacitor shells, or mobile exploration files
- old planning docs, screenshots, or prototypes unless they are already embodied in the live home page files above

If a future viewer or mobile design conflicts with this file, the home page wins.
If the home page changes, update this file from the home page again before using it elsewhere.

## Handoff Confidence

This is handoff-safe as a design source for another AI, with one important
interpretation rule: it is a visual/product-language spec, not a line-by-line
component implementation spec.

What it captures:

- the shared shell, palette, type, density, spacing, panels, buttons, search,
  menus, modals, selection mode, avatars, swatches, drag affordances, and all
  three primary tabs
- the homepage design hierarchy and interaction patterns another AI should use
  when redesigning the PDF viewer or mobile app
- the source boundary needed to avoid viewer/mobile contamination

What it does not attempt to capture:

- every prop, callback, data-loading edge case, backend permission rule, or test
  seam inside the home implementation
- exact pixel-perfect reproduction of every inline style
- behavior that belongs to the PDF viewer or mobile app

If another AI needs more detail, it may inspect only the home files listed in
the Source Boundary and then update this file from those files. It must not use
viewer or mobile files as design inspiration.

## Product Feel

Survey home is a dense workbench, not a landing page. It should feel quiet,
technical, organized, and built for repeated use. The UI favors high information
density, compact controls, visible hierarchy, and restrained color.

The visual identity is warm dark slate with a gold action/accent system. The
gold is functional: active navigation, selected rows, primary actions, and edit
affordances. Other colors appear as data identity chips, avatars, entity swatches,
or status accents.

## Shell

The home page uses a permanent two-column shell:

- Left sidebar: `148px` wide.
- Main area: fills remaining width and height.
- Sidebar background: `--ink-800`.
- Main background: `--ink-900` plus a very subtle warm radial tint.
- Sidebar border: `1px solid --ink-500`.
- Main content is clipped to the viewport, with inner scroll only inside lists.

Sidebar structure:

- Brand at top: small gold dot plus `Survey`.
- Nav list below: `Documents`, `Projects`, `Templates`.
- Profile chip pinned at bottom.
- Active nav item uses a dark raised background and a gold inset left rule.
- Disabled nav item lowers opacity and may show a lock icon.

Main header:

- Left: page title and compact subtitle/count.
- Right: search field and page actions.
- Header padding: about `12px 18px 8px`.
- Title scale: about `20px`, bold, compact.
- Subtitle scale: about `11.5px`, muted, with count emphasis.

## Tokens

### Color

Core palette:

- `--ink-900: #0d0f14` page background
- `--ink-800: #12151c` sidebar/deeper panel
- `--ink-700: #181c24` card/panel surface
- `--ink-600: #1f2430` active row/nav surface
- `--ink-500: #2a3140` main border/rule
- `--ink-400: #3a4252` stronger border/scroll thumb
- `--ink-300: #5a6473` quiet metadata
- `--ink-200: #8d96a6` secondary text
- `--bone-100: #f4f1ea` primary text
- `--bone-200: #e8e2d4` secondary warm text
- `--gold: #d8a84e` primary action/accent
- `--gold-soft: #b6904a` subdued gold
- `--gold-bg: #2a2218` gold-tinted background

Supporting accents:

- blue `#7ab7e6`
- green `#a6e07a`
- rose `#e69a7a`
- lilac `#c293e6`
- slate `#9aa3b2`
- danger `#cf6f6f`

Rules:

- Use gold sparingly and only for action, selection, current location, or editable affordance.
- Use solid colorful chips for people/entities/status; do not wash them out.
- Use borders and subtle background shifts instead of heavy shadows.
- Portalled menus and modals must use literal hex values if CSS variables will not inherit.

### Typography

Primary font (2026-10-02: one interface font everywhere, desktop, web and
phone, as `var(--font-ui)` in `src/styles/tokens.css`; the old Helvetica Neue
stack became Arial on Windows). Annotation text keeps its single-name fonts
(CLAUDE.md rule) and is not affected:

```css
-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
```

Mono font:

```css
"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace
```

Scale (whole pixels only; weights 400 / 500 / 600 / 700 only):

- Page title: `20px`, bold.
- Project/template editor title: `22px`, bold.
- Row primary text: `13px`, semibold.
- Body/control text: `12px` to `13px`.
- Metadata: `11px` to `12px`. Nothing smaller than `11px`.
- Section and column labels: `11px` / `600`, normal (sentence) case, no
  letter-spacing - the viewer's label style. No tracked capitals.
- Phone: `11 / 12 / 13 / 14 / 16 / 22`; name fields render at `16px` (iOS
  zooms on a smaller field) at weight `500`.

Implementation guard: keep new surfaces at `letter-spacing: 0`. The live home
code has a few tight display values, but do not propagate negative tracking into
viewer or mobile work.

### Spacing And Shape

- App gutter inside main content: `8px`.
- Panel gaps: `8px`.
- Sidebar padding: `16px 10px`.
- List row padding: usually `8px 8px` or `8px 10px`.
- Radii: five tokens only - `4` (chip, menu item), `6` (control), `8`
  (card, popup), `16` (phone sheet), `999` (pill): `--radius-xs/sm/md/lg/pill`.
- Row heights, desktop (`--row-*` in `tokens.css`; divider lines sit INSIDE
  the height):
  - one-line row in a side panel: `32px`
  - nested row, menu item: `28px`
  - panel header, one-line row in the main area: `40px`
  - two-line row (project/template/document): `50px`
- Row heights, phone (`--sheet-*`): every one-line row a finger taps is `44px`
  (nested rows and menu items too), two-line rows `64px`, module tabs `40px`.
- Search and primary buttons: `28px` tall.

Avoid decorative cards inside cards. Panels can be bordered, but the page should
read as a connected work surface.

## Components

### Cards And Panels

Cards are functional containers:

- background `--ink-700`
- border `1px solid --ink-500`
- small radius
- no decorative elevation by default
- scroll contained inside the panel when needed

Use panels for repeated work regions: file ledger, project tree, open project,
template list, editor body, entity rail, and preview pane.

### Buttons

Primary button:

- gold background
- dark text `#15110a`
- semibold
- compact height `28px`
- icon plus label when appropriate

Secondary button:

- dark surface
- `1px` border
- bone text
- same compact height

Ghost/text action:

- transparent background
- gold for active edit toggles like `Select` / `Done`
- muted text for passive controls

Tiny bulk buttons:

- outline border
- `18px` height
- `10px` to `10.5px` type
- labels like `All`, `None`, `Duplicate`, `Move/Copy`

Icon-only row actions:

- Use the shared `more` icon, not a text ellipsis glyph.
- Hit target is `24px x 24px`.
- Transparent background, no border, muted ink color.
- Radius `6px`.
- The same sizing applies in Documents, Projects, Templates, and team/access rows.

Modal close action:

- Use a top-right bordered square close button.
- Hit target is `24px x 24px`.
- Use `×`, not lowercase `x`.
- Border follows the modal rule color; icon color follows muted ink.

### Search

Search sits in the page header actions.

- width about `240px`
- height `28px`
- dark panel background
- border `--ink-500`
- search icon at left
- optional keyboard pill at right
- placeholder follows the current tab: `Search Documents...`, `Search Projects...`, `Search Templates...`
- Search boxes must be wired to real filtering. Do not render a decorative or
  read-only search field.

### Selection

Selection mode is consistent across tabs:

- A gold `Select` action enters selection mode.
- It changes to `Done`.
- Bulk actions appear inline near the count or section label.
- Checkboxes are square, `14px`, gold-filled when selected.
- Selected rows use `--ink-600` or a subtle gold-tinted background.
- Active non-selection rows use a gold left rule.

### Menus

More menus are compact portalled popups:

- background `#181c24`
- border `#2a3140` or `#3a4252`
- radius `8px`
- padding `4px`
- shadow `0 12px 30px rgba(0,0,0,0.45-0.55)`
- items are the shared `.hub-menu__item` (hub.css): `28px` at `12px` on
  desktop, `44px` at `15px` on the phone
- danger items use `--danger-text`

Menus anchor to the trigger and flip inside the viewport.

### Modals

Home modals use the same warm-dark language as panels, but float above the app.

Overlay:

- fixed full-screen scrim `rgba(13,15,20,0.55)`
- `blur(8px)` backdrop
- centered card
- z-index above the hub surface
- Escape closes and focus returns to the trigger

Modal card:

- background `#181c24`
- border `1px solid #2a3140`
- radius `10px`
- shadow `0 24px 60px rgba(0,0,0,0.55)`
- max width around `92vw` to `94vw`
- footer background `#12151c`

Modal header:

- vertical accent bar, usually gold or item/member color
- section label at `11px` / `600`, normal case
- title around `17px`, bold
- close button is a small bordered square

Common modal widths:

- confirm: about `380px`
- move/copy: about `420px`
- share/invite: about `440px`
- activity: about `520px`
- access management: about `620px`

Modal controls:

- role selectors and destination pickers are compact dark controls
- textarea/input fields use `#12151c`, `#2a3140` border, bone text
- primary footer action is gold unless destructive
- destructive action uses `#cf6f6f`
- inline errors are the one calm alert (`--alert-*` in tokens.css): a soft danger tint inside a thin danger edge all the way round, `--text-1` words; no 3px coloured left bar
- success/status uses low-opacity gold background plus gold border/text

### Avatars And Swatches

Avatars:

- circular
- initials only
- gold for owner/current user
- supporting accent colors for collaborators
- small sizes: `14px`, `18px`, `22px`, `24px`, `34px`

Entity swatches:

- solid circles, usually `14px` to `18px`
- border may differ from fill
- use full-strength color for identification

### Drag Handles

Drag-reorder affordances are small and quiet. The handle is separate from the
row click target so rows can still open/select normally.

Dense row dragging uses one shared opacity value from the sortable wrapper. Child
rows must not set their own drag opacity, because nested opacity multiplies.

## Tab Designs

### Documents

Documents is a ledger with a right-side preview pane.

Desktop layout:

- Main card grid: file ledger on left, preview pane on right.
- Preview open: roughly `2.2fr 1fr`.
- Preview closed: ledger fills the card.
- Ledger header is sticky, muted, sortable, in the 11/600 normal-case label style.
- Columns: action/select, thumbnail, file name, project, last edited, size.
- Selected file row gets `--ink-600` and a gold left rule.
- File thumbnails are fixed-size and centered in their own column.

Preview pane:

- section label `Preview`
- close button top right
- selected file title and metadata
- large page preview area
- team block
- last edited/uploaded metadata
- bottom-pinned action row with primary `Open file`

Empty state:

- muted line inside ledger: `No documents yet - upload a PDF to get started.`

### Projects

Projects is a Finder-style split view.

Desktop layout:

- Left project list: `260px`.
- Right open-project panel fills remaining width.
- Gap between panels: `8px`.
- Open project panel has a header, file list, and team rail.
- Team rail width: about `148px`.

Project list:

- `New Project` primary button at top.
- Select mode and bulk actions below.
- Project rows are `50px`, with drag handle or pin icon, project name, avatar stack, member count, and more button.
- Open project gets gold left rule and active background.

Open project panel:

- Header has vertical gold accent bar, editable project title, `Add files`, `Manage Team`.
- File table columns: handle, name, last edited by, edited, more/select.
- Rows are compact, about `42px`.
- Team rail uses section label, avatars, names, roles, and small online dot.

Empty states:

- No projects: centered muted copy.
- No files: muted row copy inside the file list.

### Templates

Templates is a three-panel editor.

Desktop layout:

- Left template list: `260px`.
- Center template editor: flexible.
- Right entities rail: `268px`.
- Gap between panels: `8px`.
- The editor has its own scoped warm-dark styling but should visually match the hub.

Template list:

- `New Template` primary button.
- Select mode and bulk actions.
- Template rows are `50px`.
- Active template gets gold left rule.
- Row metadata shows entity swatches and count.

Center editor:

- Header has vertical accent bar, editable template title, module count.
- Module tabs are compact, horizontal, draggable, and count categories.
- Active module has a strong underline.
- Add module is a small square gold-outline plus button.
- Categories section has a label, select controls, and `New Category`.
- Category rows are compact cards with drag handle, disclosure arrow, editable title, item count.
- Expanded category body shows checklist item rows and an `Add Checklist Item` dashed action.
- Archived items are quiet, struck-through, and separated from active checklist items.

Entities rail:

- Header has section label and `New Entity`.
- Select mode and dirty `Cancel` / `Save` controls live near the top.
- Entity rows show drag handle, color chip, editable name, and more/select.
- Color picker opens inline below the row.
- Fill/border tabs are compact, with gold active underline.

## Interaction Rules

- Prefer inline editing over separate edit dialogs for names.
- Double-click may select text, but normal click should still navigate/open.
- Enter commits inline edits.
- Escape cancels or restores the prior value where supported.
- Lists own their own scroll; shell and page do not scroll.
- Use subtle `0.15s` background/opacity transitions.
- Category expand/collapse can use about `0.18s`.
- Avoid global animation or decorative motion.
- Reorderable row lists use the shared drag handle.
- Dense reorderable row lists use the shared sortable wrapper opacity only
  (`DENSE_ROW_DRAG_OPACITY`, currently `0.62`). Do not add child-row drag opacity.
- Preserve each row family's existing drop feedback unless the home page has
  already accepted a deliberate change there.
- Do not add new drag-over highlights only for uniformity; drag feel matters
  more than making every list visually identical.
- Horizontal module tabs may use whole-tab dragging because the tab shape is the
  affordance, but module rows inside dialogs use the shared row drag handle.

## Adapting Other Surfaces

When adapting the PDF viewer:

- Pull color, typography, panel, button, search, menu, selection, and avatar rules from this file.
- Treat the viewer as a work surface that should sit inside the same product shell language.
- Do not preserve viewer-specific visual styling when it conflicts with home.
- Do not update this file from viewer observations.

When adapting the mobile app:

- Translate the same hierarchy into mobile navigation and stacked panels.
- Preserve palette, density, typography scale relationships, action hierarchy, selection behavior, and swatch/avatar language.
- Do not copy fixed desktop widths literally.
- Do not update this file from mobile observations.

## Verification

The home source can be reviewed in isolation with:

```sh
npm run dev:ui -- --host 127.0.0.1 --port 5177
```

Then open:

```text
http://127.0.0.1:5177/?hubPreview=1&tab=documents
http://127.0.0.1:5177/?hubPreview=1&tab=projects
http://127.0.0.1:5177/?hubPreview=1&tab=templates
```

Do not open the PDF viewer or mobile app while updating this design source.
