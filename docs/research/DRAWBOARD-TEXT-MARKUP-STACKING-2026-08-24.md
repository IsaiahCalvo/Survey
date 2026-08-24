# Drawboard PDF text markup stacking

Research date: 2026-08-24

Scope: first-party Drawboard help pages, product pages, and release notes only.

## What Drawboard documents

Drawboard treats Highlight, Underline, Squiggly, and Strikethrough as four distinct **Text Review** tools. Its text-selection help page says that one selected text range opens a menu containing all four actions. This is the closest official description of the requested flow: select PDF text first, then apply review actions from the selection menu.

- [Select PDF Text Tool](https://support.drawboard.com/hc/en-us/articles/4406219907471-Select-PDF-Text-Tool)
- [How to use Text Review Tools](https://support.drawboard.com/hc/en-us/articles/4406219886223-How-to-use-Text-Review-Tools)

Drawboard's iOS and Mac toolbar guide also lists Text highlight, Underline, Squiggle, and Strikethrough as separate tools in the Review group. It says tool properties such as color and opacity can be changed from the markup toolbar, with quick presets and full palettes.

- [Using Markup tools on iOS and Mac](https://support.drawboard.com/hc/en-us/articles/13324412767247-Drawboard-PDF-Using-Markup-tools-on-iOS-Mac)

The Text Review guide is more exact: for **each** of the four tools, the steps say to choose a color and opacity before dragging over PDF text. Drawboard therefore does not document one shared color or opacity that all four marks must inherit.

## Stacking conclusion

The official pages establish that the four review types are separate actions and separate annotations. They do **not** say that choosing one converts, replaces, or removes another review annotation on the same text. Drawboard also describes its removal feature as removing text-review annotations, which fits separate stored marks rather than one exclusive style field.

The first-party docs do not contain a sentence or table that explicitly says all four may overlap on the exact same text range. The user's observed Drawboard behavior supplies that last product fact. The safe implementation match is:

1. Keep Highlight, Underline, Squiggly, and Strikethrough as independent annotations.
2. Applying a different review type to a range must add it without changing marks already on that range.
3. Selecting one stacked mark must edit only that mark's type, color, opacity, or removal state unless the user has multi-selected marks.
4. Do not model the four buttons as an exclusive mode or a conversion toggle.

This means one selected text range may own up to four visible review marks at once, with each mark retaining its own color and opacity.

## Repeated actions

Drawboard's current public docs do not state what happens when the **same** review action is applied twice to the exact same range. They do not say whether it adds a duplicate, selects the existing mark, or does nothing. Do not claim Drawboard parity for that edge case without a direct product test.

Recommended rule for Survey: de-duplicate only an exact repeat of `page + text range + review type`; allow all different review types to coexist. This avoids accidental duplicate darkening while preserving the required stack.

## Color and opacity

- Drawboard documents color and opacity controls for each of the four Text Review tools.
- Drawboard documents quick color presets plus fuller property palettes on iOS and Mac.
- Drawboard does not document a default opacity for Text Review marks on the cited pages.
- A Windows release note says the general Highlighter tool defaults to 100% opacity, but it does not identify that tool as the PDF-text Text Highlighter. It is not sound evidence for a Text Review default.
- Drawboard's public docs do not state whether overlapping highlights use normal alpha blending, multiply blending, or a non-darkening blend rule.

Sources:

- [Windows release notes, version 6.70.4](https://support.drawboard.com/hc/en-us/articles/360002397875-Drawboard-PDF-Release-Notes-Windows-app)
- [Drawboard PDF product page](https://www.drawboard.com/pdf/pdf)

## Build contract supported by the research

- One text selection can receive more than one review action without losing prior marks.
- Store one annotation record per review type and range, not one record whose `type` gets changed when another action is pressed.
- Give each record its own color and opacity.
- The action bar should show independent add actions. A separate edit state can change the selected annotation.
- Keep the current 30% Survey default as a product choice; do not label it a Drawboard default.
- Add tests for all six pairwise stacks, the four-way stack, independent color/opacity edits, removal of one mark from a stack, save/reload, PDF export, and exact-repeat de-duplication.

