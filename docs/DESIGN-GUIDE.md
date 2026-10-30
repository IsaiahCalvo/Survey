# Survey design guide

One page for how Survey looks and behaves, on every screen: the website, the
desktop app (web and Electron), tablets and iPad, phone web, and the iOS and
Android apps. All of them run the same `dist` bundle and load the same
`src/styles/tokens.css`, so one rule here is one rule everywhere.

This guide replaces `docs/design/design.md` (home-page notes from before the
September palette and the October owner rulings; kept for history only). Where
the two disagree, this guide wins. Where this guide and a token comment in
`src/styles/tokens.css` disagree, the token file wins and this guide is stale.

Each rule names the shared piece to use and the test that guards it. Reuse the
piece; never hand-roll a look-alike.

## 1. Colour

All chrome colour comes from `src/styles/tokens.css`. Never type a hex in a
component for chrome.

| Job | Token |
| --- | --- |
| Area round the PDF page, app background | `--surface-0` |
| Docked chrome: toolbars, rails, panels, phone header, dock, sheets | `--panel-bg` (`--surface-2`) |
| A recessed field or well inside a panel | `--panel-well` (`--surface-1`) |
| Floating: menus, pop-ups, drop-downs, tooltips; a selected row | `--surface-3` + `--shadow-popover` |
| Hover (pointer only) / pressed | `--hover` / `--pressed` |
| Text: headings / body / captions | `--text-1` / `--text-2` / `--text-3` |
| Gold: the action and the selected state | `--accent`, `--accent-light` (hover), `--accent-press` |
| Delete and errors | `--danger` (fill, icon), `--danger-text` (words) |
| Status dots only | `--success` (never a button, border or text) |

- **Gold means "act" or "chosen".** A chosen tool, tab or option shows gold
  ink with no box behind it (`tests/selectedStateGoldInkOnly.test.mjs`). Plain
  information stays white or grey.
- **Two borders, split by job.** `--border` (subtle) for cards, panels, rows,
  dividers and every pop-up card. `--border-strong` only where the edge is the
  only thing that shows the control: inputs, outlined buttons, checkboxes,
  radios, focus. A pop-up card with `--shadow-popover` never takes
  `--border-strong` (`tests/popupCardEdge.test.mjs`).
- Selection handles stay `#4a90e2`. Ink colours belong to the user, not the
  theme. Paper stays paper.

## 2. Type

- One UI font: `--font-ui` (the system font). Fabric text uses single-name
  fonts only (see CLAUDE.md).
- Sizes come from the scale only: 10, 11, 12, 13, 14, 16, 18
  (`--font-size-xs` to `--font-size-2xl`). 13 is body, 12 is meta, 11 is a
  field label.
- **Sentence case everywhere. No ALL CAPS labels, no tracked capitals**
  (owner 2026-10-02). Section heads are 12px 600 `--text-3`
  (`--sheet-section`). `tests/noTrackedCapitals.test.mjs` fails the build on
  `text-transform: uppercase` in the app.
- **Numbers that line up** (dates, sizes, counts, page numbers) use the
  `nums` class (tabular figures in the UI font), not a monospace font. Keep
  monospace for things people copy by the character: links, codes, keys.

## 3. Shape and space

- Radius: 4 / 6 / 8 / 16 / pill (`--radius-xs` to `--radius-pill`);
  dialogs `--radius-dialog` (10). Menus and pop-up cards use `--radius-md`.
- Rows: 32px panel row, 28px nested row, 28px menu item on desktop; 44px on
  phone sheets and phone menus (`--row-h*`, `--sheet-*`). Touch targets are
  44px minimum (`src/styles/touchTargets.css`).
- Shadows: `--shadow-popover` (floating), `--shadow-sheet` (phone sheet),
  `--shadow-dialog` (dialog).

## 4. Icons

- One icon set: `src/Icons.jsx` (+ `src/assets/icons`), 24-unit grid, 1.5
  stroke, one handle radius (`tests/iconSetConsistency.test.mjs`).
- Icon buttons are bare glyphs: no box, no fill, no border, also when disabled.
- **Done** in any Select or Edit mode is `editListDone`, never a check in a
  disc and never an X (`SECTION_DONE_ICON`, `tests/sectionDoneIcon.test.mjs`).

## 5. Menus and drop-downs

| Need | Piece |
| --- | --- |
| An action menu (row More, account, export) | `MenuRows` + `MenuGlide`, `.hub-menu` grow-in |
| Pick one value from a list | `AnnotationDropdown` / `ValueSelect` (unrolls under its field) |
| Two to five joined choices | `ButtonGroup` |
| Fold open in place | `Expander` |

- One hover strip glides between rows (`MenuGlide`), red on a danger row.
- The current value in a list is gold text, no tick box.
- Width picker: typed number plus quick picks, on desktop and phone alike.
- Guards: `tests/dropdownLook.test.mjs`, `tests/actionMenuLook.test.mjs`,
  `tests/annotationDropdownUniformity.test.mjs`.

## 6. Dialogs

- Every dialog is `src/components/DialogCard.jsx`: title, message, X, footer
  bar, `hub-btn` buttons. Inside the viewer, wrap it in `BodyPortal`.
- Prefer acting at once with an Undo toast over asking "Are you sure?".
- Guards: `tests/dialogConsistency.test.mjs`, `tests/dialogTokens.test.mjs`,
  `tests/kal66DialogFocusTrap.test.mjs`.

## 7. Toasts

- One toast look: `src/components/ToastHost.jsx` via `showToast` /
  `utils/toast.js`. The calm alert card: panel surface, thin edge, a tint only
  for trouble or caution.
- Desktop and tablet: bottom centre. Phone: top, under the top bar, so the
  dock, sheets and keyboard never cover it. Same card, different spot, on
  purpose.
- Info 3 s, errors 9 s, hover pauses. Undo toasts keep their own clock.
- Guards: `tests/oneToastLook.test.mjs`, `tests/toast.test.mjs`,
  `tests/undoToastPhoneLayout.test.mjs`, `tests/undoToastTabletLayout.test.mjs`.

## 8. Tooltips

One chip from `src/components/Tooltip.jsx`; never `title=`. Wait once, then
show the rest at once; keyboard focus shows at once; touch never shows one.
Full rule: `docs/TOOLTIP-RULES.md`, guard `tests/tooltipRule.test.mjs`.

## 9. Select mode and lists

- Order everywhere: Select/Done, All/None, Duplicate, Move, Copy, Share,
  Delete. Skip what a list lacks; never reorder
  (`tests/selectModeOrder.test.mjs`).
- Swipe a row for its actions on touch (`tests/swipeActionsRow.test.mjs`).
- Focus rings show only after a keyboard move, never after a click
  (`src/utils/focusRingSource.js`).

## 10. Motion

All timing from the `--motion-*` and `--ease-*` tokens: menus 100 ms in,
dialogs 150 ms, toasts 150 ms, panels 200 ms, folds 300 ms. Every one drops to
0 under reduced motion (`tests/motionTokens.test.mjs`).

## 11. Touch and the viewer

- Touch pans; it never draws or selects by accident. Pen and mouse draw.
  See `docs/GESTURE-CONTRACT.md` and `docs/VIEWER-PAN-ZOOM-RULES.md`.
- Pressing and dragging an unselected mark only selects it.
- Close rules: `docs/DISMISS-RULES.md`. Tab switching: `docs/TAB-SWITCHING.md`.

## 12. Phone and tablet

- Phone (720px and under): panels become bottom sheets on `--panel-bg` with
  44px rows and the `--sheet-*` type. Pop-ups follow the same pop-up card
  rule as desktop.
- A native `<select>` wheel is fine on a phone for long lists.
- Tablets get the desktop layout with touch rules: no hover-only actions,
  44px targets.

## 13. Website

The marketing pages (`public/welcome`, `features`, `pricing`, `use-cases`,
`tools`, `whats-new`) share the app's colours and gold buttons but keep their
own voice on purpose: the Figtree font and small capital eyebrows over
headings. That is the only place capitals are allowed. Emails follow
`docs/design/email-style-guide.md`.

## Adding something new

1. Look for the shared piece above first.
2. Use tokens, not literals.
3. If you make a new rule, add a guard test and a line here.
