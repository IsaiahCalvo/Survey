# Appetize run 3 — edge push/pull after the fix, iPhone 16 Pro, iOS 26.0

Date: 2026-10-06. Test copy `https://walnut-sierra-vmj2.here.now` (republished
with the fix), opened in Mobile Safari from build `b_iysen3lso3aqr7grkm6yksiiuq`.
URL: `/mobile?testPdf=clickable-link-test.pdf&surveyTemplateWorkflowE2E=1&mobileNav=tabs&nativeShell=expo`

**Minutes used: 206.3 s (~3.4 min)**, one session (Appetize API
`sessionLengthSeconds`). Session stopped.

All steps ran in one script, one command at a time. A screen recording
(`appetize recording start rec/edges.mp4`, 112 s, 30 fps) covered steps A–E.
I cut it to 15 fps and measured the page top/bottom in each frame (first/last
white row at x=0.16). Rest position everywhere: **top 0.221, bottom 0.722**.
Note: the top bar covers y<0.110 and the dock covers y>0.834, so the measure
clips at those values while the page is under them.

## Results

| Step | Result | What I saw | Files |
| --- | --- | --- | --- |
| 1. Load | Pass | PDF open, no sign-in sheet. Page top 0.221, bottom 0.722. Hand tool already on. | `1-loaded.jpg` |
| 2. Tap Pan | Pass | Hand stays orange; nothing else changed. | `2-pan.jpg` |
| A. Push up past bottom (1200 ms) | **Pass** | Video: page moves **only up** (top 0.221 → under the top bar, bottom 0.722 → 0.567), then springs back down to 0.221 in ~8 frames (~0.5 s) after release. No drop below rest. 3a and 3b both at rest (0.221 / 0.722), bottom well above the dock. The run-2 bug (page at ~0.39, under the dock) is gone. | `3a.jpg`, `3b.jpg`, `rec-f0157.jpg` (peak) |
| B. Fast flick up (250 ms) | Pass | Video: up to the top bar (bottom 0.609), back to rest in ~8 frames. Screenshot at rest. | `4.jpg`, `rec-f0481.jpg` (peak) |
| C. Pull down from the link line (y 0.29) | **Pass** | Video: page moves **only down** (top 0.221 → 0.381, bottom under the dock), back to 0.222 in ~7 frames. Stayed in the viewer; the link did not open. 5a/5b at rest. | `5a.jpg`, `5b.jpg`, `rec-f0790.jpg` (peak) |
| D. Pull down on plain page | Pass | Video: only down (top → 0.376), back in ~9 frames. | `6.jpg` |
| E. Pull then push | **Odd** | The pull moved the page down (top → 0.355) and back as in D. The push that followed **did not move the page at all** (no frames off rest). Instead screenshot 7 shows a "Page / Paste" context menu near where the push started (≈0.6, 0.70): the push was read as a long-press. The CLI may wait a little before moving a swipe, or the app may still have been in its spring-back; worth a check on a real phone. Page itself at rest. | `7.jpg`, `rec-f1345.jpg` (pull peak) |
| F. Tap link `https://claude.com` | Pass | claude.com opened in Safari (sign-up page), no prompt. (Tap also closed nothing first — the context menu from E did not block it.) | `8.jpg` |

## Notes

- No step showed the page ending lower than rest; every gesture went one way
  only and settled to 0.221/0.722 within ~0.5 s.
- Recording works with CLI 0.20.0: `appetize recording start <file.mp4> --force`
  / `appetize recording stop`. Frame stepping (`ffmpeg -vf fps=15`) is a far
  better way to catch rubber-band than mid-swipe screenshots.
- Use `%04d` in the ffmpeg frame pattern; the video gives ~1700 frames at 15 fps.
