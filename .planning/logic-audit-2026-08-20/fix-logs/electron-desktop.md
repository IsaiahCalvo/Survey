# UL-03 — Native Electron File → Open (chooser drive attempt)

- Date: 2026-08-21
- Worktree: `nifty-elion-773074` (darwin, Aqua, built-in 3024×1964)
- Status: **blocked** — native chooser **opened**, but pick / cancel / force-non-PDF remain **unproven**
- IDs: **UL-03** / **P-03**
- Product fix: **none** (no `src/` edit)
- Does not mark the audit goal complete. Lease not retried. No SQL / Stripe / MSAL / captcha / wipe / Capacitor.

## Host

- Survey Electron was **not** already running. Other Electron apps (Cursor, Claude, Grok Bot, Wispr Flow) ignored.
- Started `npm run dev` in this worktree. Vite **5173** and **5174** were already taken (main repo). This instance: **`http://localhost:5175/`**.
- Unpackaged `Electron .` pid 79040, window title `Survey` (1200×800). Hub showed **Welcome back** sign-in (stale refresh token; auto-login did not finish). Not used as a pass.

## Intended — native File → Open (not IPC)

AX menu click (real macOS menu, not Playwright `dialog.showOpenDialog` stub):

```
File → Open PDF…  (accelerator CmdOrCtrl+O)
```

Result: NSOpenPanel **`Open PDF document`** appeared (CG window id 30147, 880×448). Sidebar Downloads. Filter **PDF files** active. Screenshot: `/tmp/survey-open-dialog.png`.

This is the real OS chooser. IPC-only proof (`debug/scenarios/e2e-electron-file-open.spec.mjs`, stub `{ canceled: true }`) is **prior** and was **not** re-run as a substitute.

**Pick a fixture and load the editor:** not completed. Dialog could not be driven (blocker below). `handleUploadClick` in `Dashboard.jsx` also requires a signed-in `user` after the dialog returns; that path was never reached.

## Break — cancel

Could not deliver Cancel / Escape / Cmd+. to the panel. App did not crash while the dialog was up (pid 79040 stayed healthy ~6 min). **Cancel → no empty document is unproven.** Quit survey via the app menu also no-op’d while the panel was modal. Process was killed after evidence capture so the chooser was not left on the desktop.

## Edge — non-PDF

Visual only: MP3 / JSON rows in Downloads were **grayed out**; **Open** disabled with no selection. Could not Cmd+Shift+G a `.txt` or force Open. Filter-ignore is **observed**, not interactively proven.

## Exact blocker (native chooser remains unproven)

1. **Electron AX tree is menu-bar only.** `AXUIElement` dump of pid 79040: `AXApplication` + `AXMenuBar` (`File` includes `Open PDF…`). **Zero** `AXWindow` / `AXSheet` / `AXButton` for `Survey` or `Open PDF document`. System Events `count of windows` of process `Electron` = **0** even while both CG windows exist.
2. **Screen-coordinate clicks miss the panel.** `System Events` `click at` on title-bar and Cancel estimates always hit process `loginwindow` window **`Login`** (AX error `-25208` / cannot stringify). Full-display `screencapture -D1` returned wallpaper only (window-id captures of 30141/30147 still showed Survey + the panel) — screen hit-testing is not seeing app pixels.
3. **Synthesized HID did not drive the panel.** Compiled `CGEvent` click + Escape left `Open PDF document` on screen. Keystrokes to process `Electron` also no-op (webview/sign-in likely first responder; panel not key).

IPC stub is already proven and was **not** used to claim this pass.

## Invariants

Untouched: container-aware canvas sizing, SVG `viewBox` zoom, `zoomGeneration`, single-name `fontFamily`, CORS `Access-Control-Allow-Origin: '*'`. High-risk files not edited.

## Files

- This receipt only. No product diff. Vite **5175** + Electron stopped after the attempt.
