# HANDOFF — Custom Print Panel, mid-build (2026-04-23)

We started shipping the custom Print Panel today. It opens, renders, and
every interactive control fires events correctly in an automated end-to-end
test. But on the user's Mac dev build the preview sheet and the thumbnail
strip keep showing placeholders instead of real PDF page renders. The core
reason is a **Syncfusion page-cache limitation**, not a layout bug. Next
session's job is to replace the preview source so pages render on demand
whether or not the main viewer has scrolled past them yet.

**User's working style (non-negotiable):**
- Plain English only. Max ~5 short sentences per reply.
- No file paths, no camelCase / backtick code names, no markdown headers,
  no lettered menus, no bullet lists longer than 4 items in conversational
  replies.
- Non-technical. Describe what they'll SEE, not how code is wired.
- One decision at a time. Don't overwhelm with options.

---

## Where we are

### What works (verified by end-to-end playwright run)
- Cmd/Ctrl+P opens the panel. Electron menu accelerator and a window-level
  keydown safety-net both fire the same open handler.
- The floating window has three main zones exactly as the user specified:
  top page selector bar, center preview with pager, right options panel.
- The J ↔ K variant toggle in the titlebar swaps the right options panel
  layout. J has per-section "Apply to" pills; K has three scope tabs
  across the top of the rail (All / Select / Current).
- Every control fires state change + console log: page range input, All /
  Current view / Clear quick buttons, thumbnail click, scope pills / tabs,
  paper size dropdown (Letter / Legal / Tabloid / A4 / A3 / Arch D / Arch
  E / Match page… / Custom / Auto), proportional vs stretch, orientation
  dropdown (Auto portrait / Auto landscape / Portrait force / Landscape
  force), CCW / CW rotate buttons (no-op visually for now), Mirror H / V
  toggles, Markups / Color toggles (default on), copies stepper, Collate /
  Duplex toggles, Bigger Preview overlay open / close with zoom in/out/Fit,
  destination picker with Save as PDF… option, Cancel, Print.
- Real installed printers populate the destination list via an Electron
  bridge (3 entries returned in logs).
- The Print button fires Syncfusion's built-in print for now — it really
  goes to the system printer, so the pipeline is proven.
- Live preview styling reacts to user settings (mirror and B&W classes
  apply to the sheet when their scopes include the currently-previewed
  page).

### The real open issue
**Preview and thumbnails render as placeholders for most pages, not the
real PDF content.** On a fresh open of a 99-page PDF the user only sees a
live preview for the current page once Syncfusion has rendered it; every
other thumbnail stays as a dashed outline. Our log shows this clearly:
`thumb not yet ready page=27 (returned null)` over and over for pages
Syncfusion hasn't scrolled to yet.

### Why that happens
The panel asks Syncfusion's exposed `getThumbnailDataUrl` helper for each
page. That helper only reads from the viewer's already-rendered page
canvas cache — if the user never scrolled near page 27, Syncfusion never
rendered it, and our call returns null. Also, when it does return, the
output is capped at 140×181 which makes the "big preview" blurry.

### What else to clean up next session
- **Small secondary bug:** `listPrinters not exposed — preload may need
  reload (restart dev command)` shows up in logs when the user doesn't
  fully restart the dev command. The Electron shell file hasn't been
  reloaded. Harmless but it means the destination picker starts empty
  until the user restarts. Document this or auto-fall back to a default
  printer name so the first open never shows an empty picker.
- **Per-page print pipeline:** The Print button currently calls
  Syncfusion's stock print which ignores all the per-page overrides (the
  whole reason the panel exists). jobSpec from the panel is wired and
  logged — it just needs a real renderer on the main process that applies
  each page's rotation, mirror, color, paper size, and markup-on/off,
  then fires the real print. This is the v2 task, gated by fixing the
  preview renderer first since both need the same render path.
- **Bigger Preview fidelity:** Currently uses the same 140px-wide cached
  image scaled up. Needs a high-res render path like the main preview
  will get.
- **Top thumbnail strip at huge page counts (99+):** The strip already
  scrolls horizontally but it looks a bit sparse for this many pages. Not
  broken — style polish only.

### The fix direction (recommended for next session)
Replace the preview + thumbnail image source with a dedicated render path
that does NOT depend on the main viewer's scroll position:
1. Use PDF.js directly (already a dependency) to render each page to a
   canvas on demand at whatever size the panel asks for.
2. Cache renders by `(pageNumber, targetWidth)` so scrolling the strip
   doesn't thrash.
3. Apply the user's selected per-page transforms (rotation, mirror,
   color/B&W filter, markup overlay on/off) at render time, so the live
   preview matches what will print.
4. Pipe the SAME renderer through the Print button so the printed output
   is exactly what the user previewed. The Electron main process already
   has an IPC handler named for this — needs the renderer-side bundle
   and handoff.

Everything else in the panel UI is solid, polished, and production-ready.
Only the image source is a stub.

---

## The big decisions made today (durable)

- **Built from the v3 wireframes, not the hi-fi HTML.** Claude Design
  produced a hi-fi pass but it silently dropped controls and reshuffled
  the layout. User corrected course; we used the v3 wireframes as the
  visual + functional spec.
- **Both J and K ship inside the app together.** The user wants to feel
  both for real and pick a winner through use, not through mockups.
- **Variant toggle is temporary.** Once the user picks a winner, the
  toggle in the titlebar and the losing branch's code come out.
- **Print is non-destructive.** Nothing the panel does touches the source
  PDF. Close or Cancel discards all settings. Print produces a new job /
  PDF output with the settings baked in.
- **Cmd/Ctrl+P and the File → Print menu item both open the panel.** No
  new entry point.

## Protected files — do NOT modify without explicit user waiver
Standard rules from the project's instructions still apply. The inner
render loop of the app root and the main viewer's internal Fabric /
Syncfusion coordination are off-limits. The Print Panel changes only
touched the two Electron bridge files, one top-level component file
embedded into the main screen, two small new component files, and one
place that had been calling Syncfusion's print directly (now a comment).

## What's touched by this work (for quick orientation)
- Two new files under the components folder: the Print Panel component
  and its stylesheet.
- Three small additions to the top-level screen component: a panel open
  state, a listener that opens the panel on Cmd/Ctrl+P, a callback that
  forwards the panel's Print click to the real printer. All three sit
  inside the viewer component and do not touch the render loop.
- Two small additions to the Electron bridge: a list-printers IPC handler
  and a fire-print IPC handler. The panel uses the first, the second is
  ready for the v2 per-page pipeline.
- The old direct-print listener inside the Syncfusion container was
  replaced with a short comment; the top-level screen component now owns
  that flow end-to-end.

## Diagnostic logs we planted
Every panel action has a `[PrintPanel] …` log line. Every state change
logs its name and new value. Thumbnail and preview fetches log "start",
"ready", "not yet ready", "failed" so a save-log dump tells us the whole
user journey. Keep these around until the feature stabilizes.

## Open questions for the user next session
- Is the user OK with a short "Loading page…" message on thumbnails that
  haven't been rendered yet in the main viewer, for one more session,
  while we wire the on-demand renderer? Or do they want on-demand real
  pages immediately as priority one?
- Do they want the Bigger Preview overlay to stay modal (current behavior)
  or to become a resizable floating window they can drag around?

---

## Repo state when the next session opens
- Branch: `main`. Recent commit is v0.1.8 for the earlier Save Log fix.
  No commits yet for the Print Panel work — still on the working tree.
- Working tree has the Print Panel component + stylesheet, plus small
  edits to the main screen component, the Electron main and preload
  files. Nothing dangerous but nothing committed yet either.
- Dev server may still be running on port 5173. Safe to kill and
  restart. If you do restart, the Electron shell picks up the preload
  changes so the destination picker populates on first panel open.

---

*End of handoff. Plain English with the user. One decision at a time.
First task is restoring real page previews via an on-demand renderer,
then wire the per-page print pipeline through the same path.*
