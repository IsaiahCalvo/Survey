# Drawboard stacked text-markup handle behavior

Research date: 2026-08-24

## Bottom line

Drawboard's public docs do **not** state that dragging a range handle on one selected text-review mark also changes other marks on the same text. They document Highlight, Underline, Squiggle, and Strikethrough as four separate tools and separate annotation actions. Drawboard also describes editing several annotations together as an explicit multi-select/group action. The best evidence-backed match is therefore:

- A range drag changes **only the selected text-review annotation**.
- Other highlight, underline, squiggle, or strikeout marks on the same text keep their own ranges.
- Several marks change together only after an explicit multi-select/group operation, if Drawboard permits that operation for those annotation types.

This is an inference from Drawboard's documented annotation model. It is not a quoted Drawboard rule about endpoint handles; Drawboard does not publish that rule.

## Primary-source evidence

1. Drawboard's Text Review guide gives a separate creation flow for each tool. For each of Highlight, Underline, Squiggle, and Strikethrough, the user selects that tool, chooses its color and opacity, and drags it over PDF text. It never describes a shared or linked text range across review marks.
   Source: [How to use Text Review Tools](https://support.drawboard.com/hc/en-us/articles/4406219886223-How-to-use-Text-Review-Tools)

2. Drawboard's current toolbar guide lists Text highlight, Underline, Squiggle, and Strikethrough as separate Review tools.
   Source: [Using the Markup Toolbar on Windows](https://support.drawboard.com/hc/en-us/articles/15630133419279-Drawboard-PDF-Using-the-Markup-Toolbar-on-Windows)

3. Drawboard says grouping lets users "keep selected annotations together" and edit the properties of several annotations at once. That makes joint editing an explicit selection/group operation, not the default effect of selecting one overlapping annotation.
   Source: [Drawboard PDF Product Tour](https://www.drawboard.com/pdf/product-tour)

4. Drawboard's Markup Library guide also says users must use Select to select the annotation or annotations they want to act on. It distinguishes one annotation from several selected annotations.
   Source: [Markup Library](https://support.drawboard.com/hc/en-us/articles/6644607128207-Markup-Library)

5. The first-party web app exposes the four review tools as separate controls and records created reviews as annotation actions. I could apply overlapping review tools in the live sample document, but the web build did not expose a stable, documented endpoint-handle flow that could prove a different linked-resize rule. This observation supports the separate-annotation model but is not strong enough to claim a hidden all-marks resize behavior.

## Overlap or blend controls

Drawboard officially documents **color and opacity** for every text-review tool. It does not document a user-facing text-review setting named **Layered**, **Uniform**, or **Overlap mode** in the help pages or release notes reviewed.

Drawboard's Windows release notes do refer to a highlighter **blend mode**, including a fix in version 6.78.5, but they do not define its choices or say it applies to PDF text-review highlights. The same release notes use **Highlight mode** for the line tool, which is a different feature.
Source: [Drawboard PDF Windows release notes](https://support.drawboard.com/hc/en-us/articles/360002397875-Drawboard-PDF-Release-Notes-Windows-app)

So Survey should not label its Layered/Uniform control as a copied Drawboard feature unless direct product testing later confirms the labels. Clear local semantics would be:

- **Layered:** each highlight keeps its opacity; overlaps become darker.
- **Uniform:** overlapping highlight coverage is composited once at the chosen opacity, so overlap does not become darker.

## Implementation recommendation

Keep each stacked review mark independent. When a user selects one mark and drags its left or right text endpoint, update only that annotation's text range and quad points. Do not silently resize all marks that happen to share the original range. If linked resizing is wanted, add an explicit "Select stacked marks" or group action and show that several annotations are selected before a handle drag changes them.

This avoids hidden coupling, preserves separate colors and opacity, and follows Drawboard's documented one-annotation versus selected-annotations model.
