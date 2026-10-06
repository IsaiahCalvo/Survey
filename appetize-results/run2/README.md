# Appetize run 2 — test PDF on iPhone 16 Pro, iOS 26.0

Date: 2026-10-06. Build: test copy at `https://walnut-sierra-vmj2.here.now`
(no sign-in, no database), opened in Mobile Safari from the Expo Go build
`b_iysen3lso3aqr7grkm6yksiiuq`.

URL: `/mobile?testPdf=clickable-link-test.pdf&surveyTemplateWorkflowE2E=1&mobileNav=tabs&nativeShell=expo`

**Minutes used: 253.7 s (~4.2 min)** in two sessions (Appetize API
`sessionLengthSeconds`): 209.3 s for steps 1–5, then 44.5 s for a second,
short session to retake the Pages sheet (the first try missed). Both
sessions stopped; `appetize session stop` now says "No active sessions".

## Results

| Step | Result | What I saw | Screenshot |
| --- | --- | --- | --- |
| 1. Open the test PDF | Pass | `testPdf` works on this build: the PDF ("Interactive PDF test", 1/1) opens with no sign-in sheet. Top bar sits under the status bar, clear of the notch; bottom dock and Safari bar sit above the home bar. Nothing hidden under the notch or home bar. | `1-pdf-loaded.jpg` |
| 2a. Tap Draw (pen) on the left rail | Pass | Pen turns orange; a tool row (red/blue/black, colour wheel, 3 pt, …) appears under the top bar, and a pen/highlighter/eraser sub-rail opens. | `2a-pen-selected.jpg` |
| 2b. Swipe a stroke across the page | Pass | A thin red line is drawn along the swipe near the bottom of the page. Undo turns on. | `2b-pen-stroke.jpg` |
| 2c. Undo (top bar) | Pass | Line removed; redo turns on. | `2c-after-undo.jpg` |
| 3a. Pick Text tool (4th rail button) | Pass | Text tool row shows (colour, 3 pt, Solid, Aa). | `3a-text-tool.jpg` |
| 3b. Tap page, type "hello", keyboard up | Pass | Font row (Arial, 16 pt, B I U S) replaces the tool row. The page scrolls up so the "hello" box and its ✕/✓ buttons stay in view above the keyboard and the iOS input bar. The top bar and font row stay visible; the bottom dock is under the keyboard (expected). | `3b-text-keyboard-up.jpg` |
| 3c. Tap the blue ✓ | Pass | Keyboard closes, page returns to its place, "hello" box stays on the page. | `3c-text-committed.jpg` |
| 4a/4b. Pull down past the top edge (hand tool) | Odd / not shown | Mid-pull and after-release shots are the same as before: the page did not move. Either the page (fits the screen) does not rubber-band, or the swipe was dropped — the CLI printed one "Too many concurrent calls" error because I took a screenshot while the swipe ran. Not a reliable result. | `4a-top-pull-mid.jpg`, `4b-top-pull-after.jpg` |
| 4c/4d. Push up past the bottom edge | Odd | Mid-swipe shot shows the page unmoved; the shot ~2.5 s after the swipe shows the page sitting **lower**, its bottom cut off by the dock, and the top bar's grey tool row gone. A few seconds later (5b) the page was back in its normal place, so it did settle, but slowly or after a jump the wrong way. Worth a look on a real phone. | `4c-bottom-pull-mid.jpg`, `4d-bottom-pull-after.jpg` |
| 5b. Colour picker (pen tool row, colour wheel) | Pass | "Color" sheet slides up from the bottom: 8 quick colours, a full swatch grid, opacity slider, hex field `ff0000`, 100 %, Done. Sits above the dock. | `5b-colour-picker.jpg` |
| 5a. Pages sheet (bottom dock "Pages") | Pass | Sheet with grip, tabs (pages / search / bookmarks), "1 / 1 pages", page thumbnail with menu button, and Add / Paste (greyed) / Select. In run 1 the tap on Pages only closed the colour sheet, so this shot comes from the second short session (fresh load, so "hello" is not on the thumbnail — no database). | `5a-pages-sheet.jpg` |

## Problems

- Screenshot while a swipe is still running gives "Too many concurrent calls";
  mid-pull shots are not reliable this way. A slower swipe split into hold
  steps, or a screen recording, would be needed to catch rubber-band.
- The first Pages tap closed the open colour sheet instead of opening Pages
  (one tap closes the popover; a second is needed). Normal sheet behaviour,
  but it cost a second session.
- Status-bar clock reads 2:21–2:24 in run 1 and 12:25 in run 2 (different
  simulator hosts); not an app issue.
