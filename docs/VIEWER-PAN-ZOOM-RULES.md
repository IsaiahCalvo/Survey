# Viewer pan and zoom rules

Owner ask (2026-10-27): copy how Drawboard PDF moves pages at each zoom, such
as the spring back and "when a page's horizontal extents fit within the
viewport, panning is restricted to just the vertical axis", but don't copy
blindly. These are the rules Survey follows. Code: `src/utils/panAxisRules.js`
(sideways lock, rails), `src/utils/elasticEdges.js` (spring back),
`src/components/PdfjsViewerContainer.jsx` (wiring).

How Drawboard was read: its web bundle (`pdf.drawboard.com/assets/index-*.js`:
`getTranslationBounds`, `snapRatio` / `freeRatio`, `translationPadding`) and
the live app driven headless with mouse, touchpad (wheel) and drag input.

## The rules

1. **A page that fits sideways does not move sideways.** If the widest page
   fits in the band you can see (the viewer minus any open side panel), a
   sideways touchpad swipe, Shift+wheel, Pan-tool or Space drag, pen drag,
   finger drag, two-finger pan or fling does nothing sideways: no slide, no
   stretch, no bounce. Up and down still work as usual.
   - One exception: a side panel that opened over part of the page (opening a
     panel never moves the page). The page can slide out from under it until
     it clears the panel by the page margin, and then it stops. It can never
     be pushed back under.
   - A pinch on a page that fits zooms about the page's centre line; once the
     page is wider than the band it follows the fingers again.
   - Mixed sheet sizes share one centre line, so "fits" means the widest
     sheet fits (a portrait cover in a set of landscape sheets can still move
     sideways, because the landscape sheets can).
2. **Near-straight motion runs straight ("rails").** When the page is wider
   than the view, a drag or touchpad scroll that is almost straight up and
   down (or across) moves exactly straight, so scrolling down a long sheet
   never drifts sideways. A clearly diagonal motion moves freely.
   - Drags (mouse, pen, finger): stays on a rail until the sideways share
     passes 30% (about 17 degrees); joins a rail under 20%.
   - Touchpad: firmer, as in Drawboard: breaks off past 60%, joins under 40%.
   - Every gesture starts on the up/down rail, and returns to it after 80 ms
     with no motion. A glide after letting go keeps the rail it ended on.
   - Mouse-wheel notches are already straight and are left alone.
3. **Edges spring back** (Survey's own choice; owner 2026-10-02 from Drawboard
   on iPhone). Past the top or bottom of the document, or past a side when the
   page is wider than the view, the page stretches with resistance and springs
   home. Numbers and tuning: `src/utils/elasticEdges.js` and #1201.
4. **Up and down always has the spring**, even for a document that fits on
   screen, so you can feel the end of the document. Sideways only has it when
   there is something to scroll to (rule 1).
5. **Zoom limits.** Zooming in stops at 4000% on desktop and 800% on the
   phone. Zooming out stops at a quarter of fit width (Drawboard's limit,
   owner's pick 2026-10-27): the widest sheet is then a quarter of the band
   between the panels, whatever the page count. A trackpad or finger pinch
   past a limit overshoots with resistance and eases back; mouse-wheel
   notches stop hard. Code: `getWidthFitMinimumScale` in
   `src/utils/pdfZoomMath.js`.

## Where Survey differs from Drawboard, and why

| Drawboard | Survey | Why |
| --- | --- | --- |
| Hard stop at every edge, with the page allowed 100 px past it (and it stays there) | Springs back | Owner asked for the spring (Drawboard's own iPhone app has it). |
| At fit width the page still slides 100 px each way | Locked as soon as the page fits | A page that fits has nothing to show sideways; 100 px of play is Drawboard's padding leaking through. |
| A document shorter than the view is locked up and down | Still springs up and down | The spring is how you feel the end of the document (same as iOS). |
| Side panels never change the bounds | A page under a panel can slide out of it | Survey panels float over the page and opening one never moves it, so the page must be reachable. |
| Smallest zoom is a quarter of fit width | Same | Owner's pick 2026-10-27. It replaced "the whole document fits" (commit c1495961), which shrank a 36-sheet set to about 3%, a strip of slivers. |

## Tests

- Unit: `tests/panAxisRules.test.mjs` (rails, hysteresis, lock, slide out from
  under a panel), `tests/pdfZoomMath.test.mjs` (zoom-out floor).
- Real app, headless Chromium, 2026-10-27: mouse drag, touchpad wheel, Shift +
  wheel, pen drag, one-finger touch and two-finger pinch on desktop and phone
  sizes, with and without the Pages panel open.
