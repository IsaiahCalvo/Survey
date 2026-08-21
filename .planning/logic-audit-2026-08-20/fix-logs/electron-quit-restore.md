# P2-11 restore — Electron quit waits for saveComplete

- Date: 2026-08-20
- Status: **closed**
- ID: **P2-11** (desktop quit 5s hang / abandons long saves)
- P2-36 (single-instance) left intact

## Evidence before

RECONCILE.md: transcript claimed `quitCoordinator.cjs` + 120s fallback. On disk:

- `src/electron/quitCoordinator.cjs` absent
- `src/electron-main.js:1785` still `setTimeout(checkAndQuit, 5000)`
- `app:saveComplete` was log-only (`actual quit happens via timeout`)
- `quitPolicy.cjs` was first-quit / last-window / focus only (kept)

## Files changed

- `src/electron/quitCoordinator.cjs` — recreated (same module recovered from `00fda232`)
- `src/electron-main.js` — quit + `saveComplete` only; `requestSingleInstanceLock` / `second-instance` / `focusExistingMainWindow` untouched
- `package.json` — `build.files` adds `src/electron/quitCoordinator.cjs`
- `tests/electronQuitCoordinator.test.mjs` — restored + P2-36 wiring assert

Did **not** edit: `quitPolicy.cjs`, `PDFViewer.jsx`, `preload.js`, `requestSingleInstanceLock` block.

## What landed

1. `before-quit` still uses `shouldPreventFirstQuit(isQuitting)` (quitPolicy / first-quit).
2. Live windows get `app:beforeQuit`. Quit is deferred until each window's `app:saveComplete` (PDFViewer already notifies, including clean).
3. No `checkAndQuit` and no 5s abandon.
4. Fallback is **120s only**, if a renderer never reports.
5. A second `saveComplete` after commit is a no-op.
6. Zero live windows quit immediately (coordinator `onQuit` closes file watchers then `app.quit()`).
7. P2-36: `app.requestSingleInstanceLock()` + `second-instance` → `focusExistingMainWindow(surveyMainWindow)` unchanged.

## Grep proof — 5s checkAndQuit gone

```
rg -n "checkAndQuit|setTimeout\(checkAndQuit, 5000\)" src/ tests/
```

Only hits: `tests/electronQuitCoordinator.test.mjs` `doesNotMatch` assertions. **Zero matches in `src/`.**

`app:saveComplete` now calls `quitCoordinator.markSaveComplete()`.

## Tests

```
node --test tests/electronQuitCoordinator.test.mjs tests/chromeE2EContracts.test.mjs
```

**41 pass / 0 fail** including:

- P2-11 wiring: `createQuitCoordinator` + `markSaveComplete`; no `checkAndQuit` / 5s timeout
- P2-36 preserved: lock + `second-instance` + quitPolicy helpers
- saveComplete quits immediately; second complete is a no-op; complete before begin is a no-op
- zero windows quit now; two windows wait for both; 120s fallback still exists
- chrome P-03 first-quit / last-window / focus contracts

## Remaining risk

- Not an Electron-app launch test. Coordinator + source-wiring only.
- 120s fallback still force-quits if a renderer dies without `saveComplete` (intentional hang-break).
- Extra `BrowserWindow`s (OAuth popup) that do not emit `saveComplete` can hold quit until the 120s fallback.
- `isQuitting` is set on first `before-quit`, so a later save that never arrives is the fallback path — same as intended.
