# electron-desktop

## P2-11 — Desktop quit is a fixed ~5s hang and abandons long saves
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/electron-main.js`, `src/electron/quitCoordinator.cjs` (new), `package.json` (`build.files` add for the new module)
- Intended behavior confirmed: `app:saveComplete` (already fired by PDFViewer after quit-save, including when nothing is dirty) now commits quit immediately. No 5s `setTimeout(checkAndQuit)`. Fallback is 120s only if a renderer never reports.
- Break / adversarial attempts: `saveComplete` before `beginQuit` is ignored; a second `saveComplete` after quit is a no-op (no double-quit).
- Edges covered: zero windows quit immediately; two windows wait for both completions; crashed renderer still quits via fallback (`DEFAULT_FALLBACK_MS > 5000`).
- Test command + result: `node --test tests/electronQuitCoordinator.test.mjs tests/electronPackagingContract.test.mjs` → pass (7 + packaging).
- Remaining risk: a save that is still running after 120s is still abandoned. Main cannot independently detect “nothing dirty” without the renderer signal (PDFViewer already always calls `notifySaveComplete`).

## P2-36 — Launching desktop twice races the Microsoft token cache
- Date: 2026-08-20
- Status: fixed
- Files changed: `src/electron-main.js`, `src/electron/singleInstance.cjs` (new), `package.json` (`build.files` add)
- Intended behavior confirmed: first process keeps `app.requestSingleInstanceLock()`; `second-instance` focuses/restores the existing window. `whenReady` does not create a window if the lock was lost.
- Break / adversarial attempts: second process calls `quit()` and does not keep the lock. Missing `requestLock` fails closed without throwing.
- Edges covered: destroyed/null window is a no-op; minimized window is restored then focused.
- Test command + result: `node --test tests/electronSingleInstance.test.mjs tests/electronPackagingContract.test.mjs` → pass (7 + packaging).
- Remaining risk: second-instance does not forward argv/file-open to the first window. If the first instance has not assigned `surveyMainWindow` yet, focus may no-op until the window exists.
