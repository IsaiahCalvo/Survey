# Changes you made that are NOT in your app right now

**First, a deep breath.** Nothing here is lost. Every one of these changes is safely saved on a separate, recoverable copy of the project (what the developers call a "branch"). The version of the app you're using right now simply doesn't have them folded in yet. Bringing them back is a normal, routine step. This page is the **complete list of everything you'd actually see or notice** that is currently missing — if a change isn't on this list, it's either already in your app or it's purely under-the-hood plumbing that has no visible effect on you.

Two main recoveries carry most of this work:

- **The drag-and-drop recovery** — a big batch of changes that mostly came along for the ride when the smoother drag-to-reorder work was being built. (Marked below as **rides along with: drag-and-drop recovery**.)
- **Separate fixes** — a handful of smaller, standalone repairs and improvements that live on their own. (Marked below as **rides along with: a separate fix**.)

Skim each item and tick the ones you remember.

---

## Big, clearly noticeable

These are the ones most likely to make you go "oh yes, where did that go?"

- **The whole text-formatting toolbar for annotations.** When you edit a text box or callout, a second row of controls is supposed to drop down underneath the main toolbar — color, font, font size, bold, italic, underline, strikethrough, and a little grid that sets the text's position (left/center/right and top/middle/bottom) in one click. The "Aa" text button also glows gold while you're editing. The tools are arranged so the four tool groups stay neatly centered on screen. *Rides along with: drag-and-drop recovery.*

- **Smoother, more polished drag-to-reorder everywhere.** When you drag an item to reorder it, the other rows are supposed to slide out of the way to make room, the item you're holding stays full width, you can't accidentally fling it off the list, and it settles cleanly into place without flickering or jumping. Open folders tidy themselves up while you drag. This applies across the Spaces panel, the Bookmarks panel, your open document tabs, the template editor, and your project folders. *Rides along with: drag-and-drop recovery.*

- **A proper grip handle for dragging rows.** Rows are supposed to get a dedicated little "grip" handle you grab to drag them, instead of dragging the whole row. This makes reordering feel more deliberate and consistent across your project files, project folders, and template rows. *Rides along with: drag-and-drop recovery.*

- **The expanding/collapsing right-side panel.** The rail on the right side of the PDF viewer is supposed to be able to grow and shrink. Collapsed, it's a thin strip of icons; click the arrow at the top and it widens into a fuller panel where the buttons get readable text labels like "Survey," "Spaces," "Page," "Zoom," and "Fit." *Rides along with: a separate fix.*

- **The Spaces and Survey buttons moving to the right-side panel.** The Spaces button is supposed to move from the left sidebar up to the top of the right-side panel (clicking it widens the panel and opens Spaces there). The Survey button moves out of the top toolbar back into the right-side panel (clicking it still opens the Survey panel, but doesn't widen the rail). *Rides along with: a separate fix.*

- **Creating a new project from the Survey Hub working again.** Making a new project from the Hub is supposed to work — it creates an "Untitled Project," refreshes your list, and if something goes wrong it shows a clear message asking you to check your connection and try again, rather than just silently doing nothing. *Rides along with: drag-and-drop recovery.*

---

## Smaller polish & fixes

The nice little touches and quiet repairs you might notice on a second look.

- **A teammate's Survey Marker showing up instantly.** If a teammate drops a Survey Marker on a document at the exact moment you're opening it, their marker is supposed to appear on your screen on its own — without you having to refresh the document. *Rides along with: a separate fix.*

- **Annotation lines getting thicker and thinner as you zoom.** Callout leader lines, text-box borders, and imported PDF ink lines are supposed to scale with zoom like everything else on the page, instead of staying one fixed thickness no matter how far in or out you go. *Rides along with: drag-and-drop recovery.*

- **Friendlier error messages instead of system pop-ups.** When an upload or a new-project attempt fails, you're supposed to see a gentle, dismissable message slide in at the bottom-center of the dashboard (for example, "Please sign in to upload documents" or "Please enter a project name") that you can close with an x — instead of an abrupt system pop-up box. *Rides along with: a separate fix.*

- **A clearer Share window.** In the Share window, the "Send invite" button is supposed to show a spinning loader and read "Sending..." while it works, then explain in a tidy inline message that invite delivery isn't switched on yet (rather than just closing on you). The copy-link helper text is reworded to make clear it's a preview link, with real invite links coming in the upcoming sharing release. *Rides along with: a separate fix.*

- **The settings gear icon getting a fresh look.** The settings (gear) icon is supposed to change from a thin outlined gear to a solid filled one everywhere it shows up — in your account menu, the Hub, and anywhere else the gear appears. *Rides along with: drag-and-drop recovery.*

- **No more flash when saving a template.** Saving a template is supposed to keep your edited content on screen through the save, instead of briefly flashing back to the old version before showing your changes. *Rides along with: drag-and-drop recovery.*

- **Bookmark folders opening one at a time.** Expanding a bookmark folder is supposed to open just that one folder and leave its nested sub-folders collapsed, so a deep bookmark tree doesn't all spring open at once. *Rides along with: drag-and-drop recovery.*

- **Reordering checklist items in templates.** In the template editor, you're supposed to be able to drag to reorder the checklist items inside a category — a brand-new ability. *Rides along with: drag-and-drop recovery.*

- **Some toolbar tidy-up while annotating.** A few cleanups to the annotation toolbar: the "Forms" tool category is hidden for this release, the right-click "Properties" option on annotations is removed, the line-width input only appears for drawing tools, and an empty leftover color swatch is gone. Color swatches also sit on a subtle checker background so faint colors stay visible against the dark toolbar, and the buttons no longer jiggle when you hover them. *Rides along with: drag-and-drop recovery.*

---

## Behind-the-scenes only (you will not see these)

These are real changes, but they're plumbing — nothing on your screen looks or behaves differently because of them. Listed here only so you know they exist.

- **A back-end repair to project creation and sharing permissions.** An earlier change had pointed an internal ownership check at the wrong place, which could make creating a project fail. This fixes that so owners can create and reach their projects normally. You won't see anything new — you'll just notice things working as they should. *Rides along with: drag-and-drop recovery.*

- **No more duplicate saved log files.** A fix that stops the same log file from being saved twice when the save is triggered in quick succession. This only affects the saved log files themselves, not anything you see in the app. *Rides along with: a separate fix.*

- **A large amount of internal-only code reorganization.** Beyond the visible items above, the drag-and-drop recovery and the other recoveries also carry roughly three dozen behind-the-scenes housekeeping changes (code cleanup and restructuring) that have no effect on what you see or do.

---

*That's the full set. Everything visible you've worked on and are missing is captured above, grouped so you can recover it with confidence.*
