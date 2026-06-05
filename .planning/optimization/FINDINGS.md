# Full Optimization Audit — Surfaced Findings (for human review + live test)

_Generated 2026-06-05 by the full-optimization loop. Auto-applied 25 mechanical wins separately; these 46 are surfaced, NOT applied._

Domains ordered by how load-bearing they are. Each item: severity, confidence, file, location, problem, suggested fix. NONE of these were auto-applied — review + live-test before landing.


## SECURITY (6)

### [CRITICAL · conf 0.99] macOS shell:openPath passes unvalidated path to exec() — command injection
- **File:** `src/electron-main.js` @ ipcMain.handle('shell:openPath'), line 705–706
- **Problem:** The handler only escapes double-quotes (`filePath.replace(/"/g, '\\"')`) before splicing `filePath` directly into `exec(`open "${escapedPath}"`)`. Backticks, `$()`, `$VAR`, semicolons, newlines, and other shell metacharacters are **not** escaped. A renderer-supplied path such as `/foo`$(touch /tmp/pwned)`` or `/foo${IFS}rm${IFS}-rf${IFS}~` passes through the double-quote escape unchanged and executes arbitrary shell commands under the Electron main-process user.
- **Suggested fix:** Replace `exec()` with `spawn('open', [filePath], { shell: false })`. `spawn` with `shell: false` passes the path as a literal argument array element, so no shell metacharacter interpretation occurs. This matches the non-macOS branch which already uses `shell.openPath(filePath)` safely.

### [HIGH · conf 0.98] VITE_GITHUB_LOG_TOKEN baked into the renderer bundle — secret exposed in shipped app
- **File:** `src/components/SaveLogBanner.jsx` @ Lines 135, 190 (`import.meta.env.VITE_GITHUB_LOG_TOKEN`)
- **Problem:** Vite inlines `import.meta.env.VITE_*` values into the compiled JS bundle at build time. Any user who extracts the `.asar` archive (trivially done with `npx asar extract`) can read the token verbatim from the minified bundle. The token is a GitHub Personal Access Token with at minimum write access to the `IsaiahCalvo/Survey` repository. It is passed through two IPC hops (renderer → preload → main) and also used directly in `fetch()` calls from the renderer, meaning it is also visible in DevTools Network tab. Both the desktop and the mobile/browser code paths use it.
- **Suggested fix:** Remove `VITE_GITHUB_LOG_TOKEN` from the renderer bundle entirely. On desktop, store the token only in the main process (e.g., read from an OS keychain via `safeStorage.encryptString`/`decryptString` or a main-process-only environment variable that is NOT prefixed `VITE_`). The renderer calls `ipcRenderer.invoke('logs:pushToGithub', content)` without the token; the main process reads the token from its own secure store. For the mobile/web path, route through a server-side proxy function (Supabase Edge Function or similar) that holds the token server-side and is authenticated by the current user's JWT.

### [HIGH · conf 0.97] oauth:openWindow loads any renderer-supplied URL without protocol validation
- **File:** `src/electron-main.js` @ ipcMain.handle('oauth:openWindow'), lines 1351–1434
- **Problem:** `authWindow.loadURL(authUrl)` is called with the raw `authUrl` string received from the renderer via IPC, with **no** protocol or origin check. A compromised renderer (or a renderer injected with arbitrary IPC arguments) can supply `javascript:`, `file://`, `data:text/html,...`, or a phishing URL. The auth window also lacks `sandbox: true` (the hidden print windows at lines 1025 and 1087 both include it, but this window does not), increasing the blast radius if the loaded URL exploits a Chromium bug.
- **Suggested fix:** 1. Validate `authUrl` before calling `loadURL`: parse it with `new URL()`, assert `protocol` is `'https:'`, and assert the hostname matches the expected IdP list (`login.microsoftonline.com`, `login.live.com`). Reject and resolve `{ success: false, error: 'invalid authUrl' }` otherwise. 2. Add `sandbox: true` to the auth window's `webPreferences` (matching the print hidden windows).

### [HIGH · conf 0.95] fs:readFile / fs:writeFile / fs:appendFile / fs:listDir / fs:writeFileAtomic accept arbitrary paths — unrestricted filesystem access
- **File:** `src/electron-main.js` @ ipcMain.handle('fs:readFile') line 739, 'fs:writeFile' line 749, 'fs:appendFile' line 763, 'fs:listDir' line 834, 'fs:writeFileAtomic' line 847
- **Problem:** None of these handlers validate or restrict the `path`/`filePath`/`dirPath` argument. The renderer (or any code running in the renderer via a third-party library) can read `/Users/<user>/.ssh/id_rsa`, `~/.aws/credentials`, Keychain export files, or any other path accessible to the process user. Similarly, `fs:writeFile` and `fs:writeFileAtomic` can overwrite any file on disk, including system binaries accessible to the user. The only guarded handler is `fs:clearDir`, which requires the path to contain `'TestLogs'`.
- **Suggested fix:** Derive an allowlist of root directories (e.g., the path returned by `dialog.showOpenDialog`, the app's `userData` directory via `app.getPath('userData')`, and any path returned by a prior `dialog.showSaveDialog`) and store them in main-process state. On each IPC call, resolve the incoming path with `path.resolve()` and assert that it starts with one of the allowed roots (`resolvedPath.startsWith(allowedRoot + path.sep)`). Reject requests outside the allowlist.

### [HIGH · conf 0.93] setWindowOpenHandler keyword allowlist is trivially bypassable
- **File:** `src/electron-main.js` @ win.webContents.setWindowOpenHandler, lines 370–384
- **Problem:** The handler returns `{ action: 'allow' }` for any URL whose string contains `'oauth'`, `'google'`, `'supabase'`, `'microsoft'`, `'login.microsoftonline.com'`, or `'login.live.com'`. This means a URL like `https://attacker.com/steal?r=google` or `https://evil.com/oauth/callback` satisfies the check and opens an uncontrolled renderer window. If a cross-origin `window.open()` can be triggered (e.g., via a malicious PDF link or a compromised dependency), this allows spawning an uncontrolled BrowserWindow that could phish credentials or exploit Chromium. The `shell.openExternal` fallback in the else-branch correctly validates the protocol, but the `allow` branch has no such guard.
- **Suggested fix:** Replace substring checks with an exact-hostname allowlist: parse the URL with `new URL(url)`, verify `protocol === 'https:'`, and check `hostname` against a Set of known IdP hostnames (`login.microsoftonline.com`, `login.live.com`, `accounts.google.com`, `supabase.co`, `*.supabase.co` via `endsWith`). Deny everything else (call `shell.openExternal` only after its own protocol check). Remove the `'about:blank'` exception or handle it separately with an immediate navigation listener.

### [MEDIUM · conf 0.82] Continuous renderer console log persists OAuth access tokens to disk
- **File:** `src/electron-main.js` @ win.webContents.on('console-message') sink, lines 283–284; appendContinuous() writes to CONTINUOUS_LOG_PATH
- **Problem:** Every `console.*` call in the renderer is unconditionally captured and appended to `<appPath>/Logs/renderer-console.continuous.log`. MSAL, Supabase auth-js, and app auth flows can and do emit debug lines that include OAuth `code`, `access_token` fragment, or session metadata (see `authConfig.js` `loggerCallback`, `AuthContext.jsx` dev-auto-login log). Because the file is capped at 5 MB and kept indefinitely between sessions, an attacker with local file-system read access (malware, a compromised companion process) gains a persistent exfiltration channel for auth secrets. The file is also read back to the renderer on demand via `logs:readContinuous`.
- **Suggested fix:** 1. Before calling `appendContinuous`, scrub the `message` string through a redaction function that replaces known patterns (`access_token=[^&]+`, `code=[a-zA-Z0-9_-]+`, `token\s*[=:]\s*[^\s,}]+`) with `[REDACTED]`. 2. Reduce the default log level captured: only write `level >= 2` (warning/error) in production builds; verbose/info are only captured when `NODE_ENV === 'development'`.


## IPC (9)

### [HIGH · conf 0.97] dialog:openFile and fs:readFile use fs.readFileSync — blocks main process for large PDFs
- **File:** `src/electron-main.js` @ dialog:openFile handler line 661; fs:readFile handler line 741
- **Problem:** Both ipcMain handlers declare async but immediately call fs.readFileSync(filePath). A 50–200 MB PDF blocks the Electron main process event loop for the entire read duration (100–500 ms on spinning-disk or network drives), stalling every other IPC call, menu events, and the before-quit sequence for that window. fs:writeFile (line 755), fs:appendFile (line 769), and fs:writeFileAtomic (lines 853–869) have the same pattern for writes.
- **Suggested fix:** Replace with fs.promises.readFile / fs.promises.writeFile / fs.promises.appendFile. For writeFileAtomic, use the async variants of rename, unlink, and mkdir. Example: `const data = await fs.promises.readFile(path);`

### [HIGH · conf 0.95] fs.statSync on every renderer console message in main process
- **File:** `src/electron-main.js` @ appendContinuous(), lines 46-51, called from console-message handler at line 284
- **Problem:** appendContinuous() fires synchronously on every renderer console.log/warn/error. It calls fs.statSync(CONTINUOUS_LOG_PATH) on every message to check file size. When the log grows past 5 MB, it additionally calls fs.readFileSync (reads 5 MB into memory) then fs.writeFileSync (writes 2 MB back) — all three blocking the main-process event loop. A verbose renderer that emits hundreds of messages per second (annotation drag, PDF render progress) will spike main-process latency for all IPC handlers while the truncation I/O runs.
- **Suggested fix:** Track log size in a module-level counter that increments by line.length after each append, avoiding statSync entirely on the hot path. Move the size-cap truncation to a low-frequency setInterval (e.g., every 30 s) that uses fs.promises (async) so main-process IPC is never blocked.

### [HIGH · conf 0.95] shell:openPath macOS exec() path is only quote-escaped — shell metacharacter injection
- **File:** `src/electron-main.js` @ shell:openPath handler lines 705-706: `const escapedPath = filePath.replace(/"/g, '\\"'); exec(\`open "${escapedPath}"\`)`
- **Problem:** The handler escapes only double-quote characters. Backticks, $(), semicolons, newlines, and other shell metacharacters in the filePath string are passed verbatim to exec() with shell:true. Any renderer code that passes a path sourced from Supabase DB data (e.g., linkedExcelPath stored in templates) or user input could inject arbitrary shell commands. For example, a path containing a newline followed by a command would execute that command as the current user.
- **Suggested fix:** Replace exec() with `spawn('open', [filePath], { shell: false })` which passes the path as a direct argv element to the open binary, bypassing the shell entirely. The shell: false flag is the only safe option here.

### [HIGH · conf 0.88] oauth:openWindow loads authUrl in BrowserWindow without protocol validation
- **File:** `src/electron-main.js` @ oauth:openWindow handler line 1433: `authWindow.loadURL(authUrl)`
- **Problem:** authUrl and redirectUri are accepted from the renderer without any protocol/scheme validation before calling authWindow.loadURL(authUrl). The redirectUri is used in a startsWith() check (line 1378) which could be tricked by a URL like 'file:///etc/passwd#https://login.microsoftonline.com'. An XSS in the renderer or a compromised renderer (Electron threat model) could open a hidden BrowserWindow loading a file: or javascript: URL. The auth window also has no preload and no webSecurity option explicitly set.
- **Suggested fix:** Validate both arguments before use: `const parsed = new URL(authUrl); if (!['https:'].includes(parsed.protocol)) return resolve({ success: false, error: 'invalid-auth-url' });`. Also validate redirectUri is a known constant value rather than treating arbitrary renderer input as safe.

### [MEDIUM · conf 0.99] Hardcoded absolute developer-machine path written on every menu Save Log invocation
- **File:** `src/AppShell.jsx` @ line 217: `'/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/1.log'`
- **Problem:** The onSaveLogMenu handler calls `api.writeFile('/Users/isaiahcalvo/Desktop/Survey-BetaSafeS2/1.log', ...)` — a path that is only valid on one developer's machine. On any other machine the write silently fails (the writeFile handler catches the error), but on the developer's machine this writes a potentially large console dump to the Desktop unconditionally on every menu Save Log trigger. The path also leaks the developer's username into the shipped bundle.
- **Suggested fix:** Remove or gate this write behind `if (import.meta.env.DEV)`. The logs:saveSnapshot IPC call on the next line (line 230) already handles durable local logging under the project's Logs/ directory for all machines, making this write redundant.

### [MEDIUM · conf 0.95] fileWatcher sends to event.sender without isDestroyed() guard — crashes on window close
- **File:** `src/electron-main.js` @ fileWatcher:start handler lines 922, 927, 932: `event.sender.send(...)`
- **Problem:** The chokidar watcher captures event.sender (the WebContents that registered the watcher) at setup time. If the renderer closes its tab or the app navigates before fileWatcher:stop is called, subsequent file-change callbacks call event.sender.send() on a destroyed WebContents, which throws an unhandled error in the main process. The Map is keyed by watchId, so the watcher keeps running and re-throwing on every file-system event until the app quits.
- **Suggested fix:** Guard each send: `if (!event.sender.isDestroyed()) event.sender.send(...)`. Additionally, listen to the renderer's `destroyed` event to auto-stop and delete the watcher: `event.sender.once('destroyed', () => { watcher.close(); fileWatchers.delete(watchId); })`.

### [MEDIUM · conf 0.93] dialog:openFile sends PDF bytes as plain JS Array instead of Uint8Array — 3-5× IPC overhead
- **File:** `src/electron-main.js` @ dialog:openFile handler line 670: `data: Array.from(data)`
- **Problem:** Array.from(Buffer) converts a Node Buffer into a plain JS number array before structured-clone serializes it across the IPC bridge. A 50 MB PDF becomes a 50-million-element array of integers, which the structured-clone algorithm serializes as a generic object array rather than a binary TypedArray. The renderer at Dashboard.jsx:514 immediately wraps it back in `new Uint8Array(result.data)`. Sending a Uint8Array instead lets the IPC bridge use the fast binary transfer path and avoids allocating the intermediate array.
- **Suggested fix:** Return `data: new Uint8Array(data)` (or just return the Buffer directly — Electron's IPC will structured-clone it as a Uint8Array on the renderer side). Remove the `Array.from(data)` call.

### [MEDIUM · conf 0.9] Chatty sequential fileExists IPC loop for OneDrive path discovery — N+2 round-trips per open
- **File:** `src/SurveySpacesRail.jsx` @ lines 2717-2760: getHomeDir → listDir → for-loop of sequential fileExists calls
- **Problem:** The OneDrive path-resolution flow serially awaits getHomeDir(), then listDir(), then calls fileExists() in a for-of loop awaiting each result before trying the next path. With N OneDrive-variant folders plus 2 legacy paths, this is at minimum 4 sequential IPC round-trips (each ~1–2 ms in-process, but serializing the main-process handler queue). The same pattern is duplicated at PDFViewer.jsx lines 12878-12890. Calling Promise.all on all candidate fileExists checks simultaneously and taking the first truthy result would cut the latency to a single round-trip in the common single-OneDrive case.
- **Suggested fix:** Batch all fileExists checks in parallel: `const results = await Promise.all(possibleLocalPaths.map(p => window.electronAPI.fileExists(p).catch(() => false))); const localPathFound = possibleLocalPaths.find((_, i) => results[i]) ?? null;`. The getHomeDir + listDir calls can also be moved behind a session-level cache since the OneDrive folder layout does not change within a session.

### [MEDIUM · conf 0.87] fs:readFile / fs:writeFile / fs:listDir accept arbitrary renderer-supplied paths with no validation
- **File:** `src/electron-main.js` @ fs:readFile line 739, fs:writeFile line 749, fs:listDir line 834
- **Problem:** All three handlers accept a path string from the renderer with no type check, no prefix/allowlist constraint, and no path-traversal sanitization. Any renderer-side code (or a compromised renderer) can read or overwrite arbitrary files accessible to the app's OS process, including ~/.ssh/id_rsa, system keychains, or other application data. fs:clearDir does have a 'TestLogs' guard; the others do not. Contrast shell:openExternal which validates the protocol.
- **Suggested fix:** Define an explicit set of allowed base directories (e.g., app.getPath('documents'), app.getPath('userData'), the project Logs path) and validate that path.resolve(filePath) starts with one of those prefixes before proceeding. At minimum add `if (typeof filePath !== 'string' || !filePath) throw new Error('invalid path');`.


## COLLABORATION (6)

### [CRITICAL · conf 0.97] Y.Map.clear() races a concurrent peer write during source-of-truth reshape
- **File:** `src/hooks/useAnnotationCloudSync.js` @ lines 1399-1404
- **Problem:** The cutover reshape fires `phase30Ydoc.transact(() => { durableYMap.clear(); durableCalloutYMap.clear(); }, originPayload)` then immediately `await fanOutCrdtForAnnotationsByPage(...)` and `await fanOutCrdtForCallouts(...)`. The two fanOut calls are async and happen OUTSIDE the clearing transact. Any remote Y.applyUpdate that arrives during the await lands on the now-empty Y.Map, gets merged by Yjs CRDT semantics, and is then overwritten when applyFabricCreate re-sets the same keys during fan-out. A second collaborator editing the same document will have their live in-flight changes atomically wiped. The clear transact also broadcasts an empty-map update to all connected peers via ydoc.on('update'), instantly blanking every collaborator's canvas for the entire re-population window. Under concurrent access the bridge CREATE branch writes meta.createdAt = Date.now() and clobbers the remote user's original createdAt.
- **Suggested fix:** Do not clear the shared Y.Maps during a live collaborative session. Call fanOutCrdtForAnnotationsByPage and fanOutCrdtForCallouts directly without the preceding clear: the bridge's per-key idempotency (shallowEqual short-circuits EDIT-branch no-ops, meta.authorId sentinel prevents double-CREATE) handles already-present entries. Keys present in the Y.Map but absent from the durable snapshot are collaborative edits that arrived during the hydrate and must be preserved, not wiped. If a hard reset is truly required, the clear and re-population MUST happen inside a single ydoc.transact callback so the entire clear+write is one atomic broadcast.

### [HIGH · conf 0.95] Callout fan-out has no wrapping transact - concurrent peer observes partial delete+upsert state and O(n) broadcasts fire
- **File:** `src/hooks/useAnnotationCloudSync.js` @ lines 911-946
- **Problem:** Unlike `fanOutCrdtForAnnotationsByPage` (which wraps all writes in one outer `phase30Ydoc.transact` at line 756), `fanOutCrdtForCallouts` calls `applyCalloutDelete` and `applyCalloutCommit` in two separate sequential loops with no outer transact. Each call opens its own `ydoc.transact` internally. A multi-callout save event (rename that removes one ID and upserts another) broadcasts N separate Y.Doc updates. Each update fires `ydoc.on('update')` which the SupabaseYjsProvider `onLocalUpdate` handler sends as a separate Supabase Realtime broadcast frame. A remote peer applying these updates one-by-one observes intermediate states (delete without re-add, stale add without delete), leading to a transient callout-missing flash and potential annotation corruption if a peer writes during the window.
- **Suggested fix:** Wrap the entire fanOutCrdtForCallouts body in a single `phase30Ydoc.transact(() => { /* all deletes + upserts */ }, originPayload)`. Yjs nested-transact coalesces all inner transacts from applyCalloutDelete and applyCalloutCommit into one outer update broadcast. This is the same optimization applied to fanOutCrdtForAnnotationsByPage and removes both the intermediate observable states and the O(n) broadcast overhead.

### [HIGH · conf 0.91] Module-scoped `applyingRemote` boolean is shared across all canvas instances - concurrent multi-canvas applies suppress unrelated handlers
- **File:** `src/lib/collab/crdtAnnotationBridge.js` @ lines 58, 479, 498
- **Problem:** The `applyingRemote` flag is declared at module scope as a single boolean. When multiple FabricEditCanvas instances are alive simultaneously (two documents open side-by-side), `applyYUpdateToFabric` for canvas A sets `applyingRemote = true`. A concurrent call for canvas B that fires before the microtask reset reads true from a completely unrelated apply and suppresses its own object:modified handler. When two remote applies are dispatched in the same synchronous frame (Supabase Realtime can deliver batched queued updates), the second call's obj.set() fires object:modified before the first reset microtask runs, the shared flag is still true, and the second canvas's legitimate local commit is suppressed, silently dropping a real user edit from Y.Doc.
- **Suggested fix:** Replace the module-scoped boolean with a per-canvas flag. Each FabricEditCanvas keeps `const applyingRemoteRef = { current: false }` and passes it to both `applyYUpdateToFabric` and `isApplyingRemote`. The bridge functions accept an optional `applyingRef` param and fall back to the module flag for callers that have not yet been updated. This restores per-canvas isolation without changing the echo-loop semantics.

### [MEDIUM · conf 0.93] fanOutCrdtForDeletedIds loops per-annoId without a wrapping transact - N separate broadcasts for one eraser gesture
- **File:** `src/hooks/useAnnotationCloudSync.js` @ lines 835-885
- **Problem:** The delete fan-out calls `dualWriteFabricDelete` (which internally calls `applyFabricDelete` then `ydoc.transact(...)`) in a for loop with no outer wrapping transact. An eraser stroke deleting 50 annotations in one gesture creates 50 separate Y.Doc transactions, each broadcasting a separate Supabase Realtime frame. Remote peers observe 50 sequential partial states rather than one atomic multi-delete. This is the symmetric problem to the callout fan-out finding above. The `fanOutCrdtForAnnotationsByPage` function already demonstrates the correct pattern.
- **Suggested fix:** Wrap the `for (const annoId of deletedIds)` loop in a single `phase30Ydoc.transact(() => { /* all deletes */ }, originPayload)`. The inner applyFabricDelete calls open their own ydoc.transact but Yjs coalesces nested transactions. This collapses N delete broadcasts into one. The existing `stopUndoCaptureForDoc` call inside applyFabricDelete is idempotent across multiple calls within the same outer transact.

### [MEDIUM · conf 0.93] useRemoteEditors creates a new Map on every awareness change triggering re-renders when visible state is unchanged
- **File:** `src/hooks/useRemoteEditors.js` @ lines 65-85
- **Problem:** Every awareness `change` event unconditionally calls `setEditors(next)` with a freshly constructed Map. Because React's useState setter uses Object.is for bail-out (a new Map !== a previous Map even with identical contents), EVERY awareness update forces a re-render of every consumer of useRemoteEditors(), including CollaboratorOutlineOverlay. In a multi-user session with active cursor tracking, awareness events can arrive at 5-10 Hz per peer, making this a continuous re-render source for all mounted consumers including the annotated page.
- **Suggested fix:** Before calling setEditors(next), structurally compare new Map with the previous one. A key-count check plus entry-by-entry comparison (userId, colorSlot, name) is sufficient. Only call setEditors(next) when at least one entry has changed. Track previous state in a ref: `const prevRef = useRef(new Map()); if (!mapsEqual(prevRef.current, next)) { prevRef.current = next; setEditors(next); }`.

### [MEDIUM · conf 0.88] dedupePdfImports runs two full Y.Map forEach passes and O(n^2) IoU loop every doc open with no fast-path guard for already-clean docs
- **File:** `src/lib/collab/crdtDedupePdfImports.js` @ lines 95-249
- **Problem:** The one-time marker gate was deliberately removed to handle Y.Map recovery re-imports. Every document open now runs two full O(n) forEach passes over the entire Y.Map plus an O(n^2) per-page IoU bounding-box comparison. On a sealed doc with 22k entries this is synchronous main-thread work inside the YDocProvider mount effect. The IoU loop builds per-page arrays of all path-typed annotations and compares every pair: worst case O(k^2) where k is ink strokes per page (potentially thousands on a heavily-annotated page). This contributes directly to the documented open-time stall.
- **Suggested fix:** Restore a fast-path guard using the lastGoodSize anchor: if `yMapAnnotations.size === lastGoodSize` (exact match) and DEDUPE_DONE_KEY is set, skip both passes entirely. A size match plus the done marker proves the Y.Map has not changed since the last successful dedupe. The backfill recovery re-imports that motivated the removal always increment yMapAnnotations.size past lastGoodSize, so the guard fires only when appropriate. Gate the O(n^2) IoU pass behind a separate `dedupe_iou_v1_done` flag so it runs once per doc.


## INTERACTION (5)

### [HIGH · conf 0.97] document.querySelector on every wheel event — live DOM query in the hot gesture path
- **File:** `src/PDFViewer.jsx` @ wheelHandler closure, line 19201
- **Problem:** Every wheel event (60+/s during scroll/zoom) calls `document.querySelector('[data-keyboard-shortcuts-modal="true"]')`. This is a full document tree walk on the hot non-passive capture-phase handler, holding up compositing. The modal is almost never open during normal use.
- **Suggested fix:** Track modal open state in a ref (`keyboardShortcutsModalOpenRef`) toggled when the modal mounts/unmounts, then replace the querySelector with a ref-read: `if (keyboardShortcutsModalOpenRef.current && keyboardShortcutsModalOpenRef.current.contains(e.target)) return;`

### [HIGH · conf 0.95] RegionSelectionTool.handleMouseMove calls getBoundingClientRect + two unbatched setState on every pointermove event
- **File:** `src/RegionSelectionTool.jsx` @ handleMouseMove, lines 1097-1111
- **Problem:** On every `mousemove` (both via `onMouseMove` prop and the document capture fallback at line 2006), `handleMouseMove` (1) calls `targetElement.getBoundingClientRect()` to check containment (forced synchronous layout read), (2) unconditionally calls `setIsCursorOverCanvas(isWithinCanvas)` (line 1104) and (3) calls `setCursorPosition({x, y})` (line 1108). Each `setState` schedules a React re-render. Two unbatched re-renders per pointer event fire at the compositor-blocking 60 Hz gesture rate.
- **Suggested fix:** Cache the bounding rect in a ref updated by a passive `ResizeObserver` + the existing `measureRect` handler instead of reading it per-move. Drive cursor position via a ref + direct DOM style write (same pattern used for the eraser cursor ring at line 19475). Keep `setIsCursorOverCanvas` but guard it with an `if (prev !== isWithinCanvas)` ref check so it only fires on entry/exit, not every move.

### [HIGH · conf 0.95] RegionSelectionTool document capture listeners detach + re-attach on every drag-frame due to regions/interactionState in handleMouseMove deps
- **File:** `src/RegionSelectionTool.jsx` @ useEffect lines 1976-2015; handleMouseMove deps line 1266
- **Problem:** The `handleMouseMove` useCallback lists `regions` and `interactionState` in its deps (line 1266). During a resize/move drag `setRegions()` is called on every mouse-move frame, producing a new `regions` array each frame, which invalidates `handleMouseMove`'s identity, which causes the effect at line 1976 (whose deps include `handleMouseMove`) to run its cleanup + setup on the next render — detaching and immediately re-attaching all three document capture listeners (`mousedown`, `mousemove`, `mouseup`, each in capture phase) mid-gesture at up to 60 Hz.
- **Suggested fix:** Move the mutable state reads inside `handleMouseMove` to refs (`regionsRef` already exists at line 216; add an `interactionStateRef`). Remove `regions` and `interactionState` from the `handleMouseMove` useCallback deps. The effect at line 1976 will then only re-run on true structural changes (active, targetElement, activeTool) rather than every pointer-move frame.

### [MEDIUM · conf 0.88] Non-zoom wheel scroll in pdf.js path calls e.preventDefault() + synchronous scrollTop/scrollLeft write on every wheel event without rAF coalescing
- **File:** `src/PDFViewer.jsx` @ handleWheel, lines 19183-19186; wheelHandler effect, line 19228
- **Problem:** The non-Ctrl/Cmd wheel branch (line 19178) calls `e.preventDefault()` then writes `container.scrollTop += e.deltaY` and `container.scrollLeft += e.deltaX` synchronously inside a `{ passive: false, capture: true }` document-level listener. This blocks the compositor on every wheel tick. The comment says the overlay div blocks events from reaching the container; on the pdf.js engine the overlay is `pointer-events:none` except for annotation interaction, so many events could be passed through natively without JS-driven scrolling.
- **Suggested fix:** Check whether `e.target` or any ancestor has `pointer-events` != none before calling `preventDefault()`. For events that the overlay is transparent to, skip the handler entirely and let native scroll proceed. For the subset that genuinely need JS-driven scroll, batch with a rAF (accumulate `deltaY`/`deltaX` in a ref, schedule one rAF write, coalesce multiple events into a single scrollTop assignment per frame).

### [LOW · conf 0.93] containerStyle useMemo depends on eraserCursorPos.visible — any eraser entry/exit causes a full containerStyle recompute and re-render
- **File:** `src/PDFViewer.jsx` @ containerStyle useMemo, line 20079
- **Problem:** `containerStyle` (line 20040) lists `eraserCursorPos.visible` in its deps (line 20079). The eraser tool uses `cursor: none` when `activeTool === 'eraser'` (line 20062), not conditioned on `eraserCursorPos.visible`. So `eraserCursorPos.visible` does not actually change the cursor style computed here — it is a stale dep. On every eraser entry/exit the container remounts a new style object unnecessarily.
- **Suggested fix:** Remove `eraserCursorPos.visible` from the `containerStyle` useMemo deps array. The cursor is already driven by `activeTool === 'eraser'` and does not change with visibility.


## RENDERING (6)

### [HIGH · conf 0.97] SVGAnnotationLayer `filteredAnnotations` useMemo: `activeTool` and `editingAnnotationIndex` in deps but never read inside the memo body
- **File:** `src/components/SVGAnnotationLayer.jsx` @ lines 1831-1849 (useMemo deps array); memo body lines 1431-1830
- **Problem:** `filteredAnnotations` is an expensive per-annotation filter+render-dispatch loop (O(n) over all page annotations). Its deps array at lines 1846–1847 lists `activeTool` and `editingAnnotationIndex`. A grep of the memo body (lines 1431–1831) confirms neither identifier appears anywhere inside the loop — they are not used to decide visibility, dispatch type, or interactivity inside `filteredAnnotations`. The result is that every tool switch (pen → select, select → pan, etc.) and every edit-mode entry/exit triggers a full re-filter and re-dispatch of potentially hundreds of annotation objects and their render function calls (`renderPath`, `renderRect`, etc.), even though the visual output is identical.
- **Suggested fix:** Remove `activeTool` and `editingAnnotationIndex` from the `filteredAnnotations` deps array. The edit-visibility logic (`hideForEdit`, `isBeingEdited`) is applied in `wrappedAnnotations` (the render-body map), not inside `filteredAnnotations`, so those two values are already handled in the correct location.

### [HIGH · conf 0.91] SVGAnnotationLayer: `wrappedAnnotations` is an un-memoized `.map()` that re-dispatches all render functions on every pointer-move drag frame
- **File:** `src/components/SVGAnnotationLayer.jsx` @ line 3153: `const wrappedAnnotations = stagedAnnotations.map(...)` (render function body)
- **Problem:** `wrappedAnnotations` is a plain `.map()` call in the render function body, not a `useMemo`. It reads `visualTransform`, `selectedIds`, `hoveredId`, `counterHandlePreview`, `editingAnnotationIndex`, and `liveTextEditBounds` from component scope. During an active drag, `useSVGInteraction` updates `visualTransform` on every `pointermove` event (~60 fps). Each update re-renders the SVGAnnotationLayer component, which causes `wrappedAnnotations` to re-map the entire `stagedAnnotations` array and re-call all render dispatch functions (`renderPath`, `renderRect`, `renderLine`, etc.) for every annotation on the page — even annotations not involved in the drag. On a page with 200 strokes, this is 200 render function calls per animation frame during drag.
- **Suggested fix:** Wrap `wrappedAnnotations` in a `useMemo` with deps `[stagedAnnotations, visualTransform, selectedIds, hoveredId, counterHandlePreview, editingAnnotationIndex, editingAnnotationEditType, liveTextEditBounds, effectiveSelectedCalloutIds, isSelectTool, isBeingEdited-related-deps]`. The existing comment at line 1428 explains why selection wrapping was intentionally kept in the render body (to avoid memo invalidation on selection changes), but in practice the full re-map is more expensive than the occasional memo invalidation. Alternatively, extract each per-annotation wrapper into a `memo`-wrapped `AnnotationWrapper` component that receives only the props it needs, so React can skip re-rendering wrappers whose annotation + selection state did not change.

### [MEDIUM · conf 0.95] PDFPageCanvas: redundant `page.getViewport` call on every React render
- **File:** `src/components/PDFPageCanvas.jsx` @ line 210 (render function body) vs line 104 (performRender async body)
- **Problem:** `page.getViewport({ scale })` is called unconditionally in the JSX render function at line 210 (to size the wrapper div) on every React render, including renders triggered by `hasRendered` state changes, parent re-renders, or `isVisible` prop flips. This is separate from the identical call inside `performRender` at line 104. pdf.js `getViewport` is synchronous but still allocates a new viewport object and does matrix math on every call; on a page with 100 thumbnails in the sidebar or dozens of PDF pages visible, this executes on every render cycle.
- **Suggested fix:** Cache the viewport in a `useMemo` or `useRef` keyed on `(page, scale)` and share it between the render-body size calculation and the `performRender` async function. Example: `const cachedViewport = useMemo(() => page?.getViewport({ scale }), [page, scale]); // use cachedViewport in both the wrapper div sizing and pass it into performRender`.

### [MEDIUM · conf 0.93] SVGAnnotationLayer: `importedDebugRows` + `JSON.stringify` (`importedDebugSignature`) run unconditionally on every annotation change even when no imported annotations exist
- **File:** `src/components/SVGAnnotationLayer.jsx` @ lines 3070-3077 (importedDebugRows useMemo, importedDebugSignature useMemo)
- **Problem:** `importedDebugRows` filters `filteredAnnotations` for `isPdfImported` objects and maps them to debug summaries (line 3070-3073), then `importedDebugSignature` runs `JSON.stringify(importedDebugRows)` on every change (line 3076). Both fire whenever `filteredAnnotations` changes. On a page with 300+ pen strokes and no imported annotations, `filteredAnnotations` changes on every annotation add/delete, running a `.filter().map()` and a `JSON.stringify([])` unconditionally. The `useEffect` that consumes these (lines 3116-3139) early-returns on `importedDebugRows.length === 0`, but the two memos still execute regardless.
- **Suggested fix:** Gate the `importedDebugRows` useMemo: `const importedDebugRows = useMemo(() => { if (typeof window === 'undefined' || !window.__DIAG_SVG_RENDER_SUMMARY) return []; return filteredAnnotations.filter(...).map(...); }, [filteredAnnotations])`. Move the flag check inside the memo so both memos are no-ops when the diagnostic is off. Alternatively, delete both memos and do the filter+stringify inline inside the `useEffect` behind the existing flag check.

### [MEDIUM · conf 0.88] pdfRender.worker.js tile render: missing `alpha: false` and no DPR scale transform on OffscreenCanvas
- **File:** `src/workers/pdfRender.worker.js` @ line 42: `canvas.getContext('2d')` and lines 41-55 (RENDER_TILE handler)
- **Problem:** The RENDER_TILE handler acquires the OffscreenCanvas context with no options (`canvas.getContext('2d')`), so it gets an alpha-premultiplied context instead of the opaque `alpha: false` path that the main-thread PDFPageCanvas uses. This forces the GPU compositor to handle per-pixel alpha blending for every tile, ~10–15 % slower on typical pages. Additionally, the worker never sets a devicePixelRatio scale transform on the context (PDFPageCanvas uses `context.setTransform(outputScale, 0, 0, outputScale, 0, 0)`). If the main thread creates the OffscreenCanvas at CSS pixels × DPR but the worker renders at CSS pixel density, the tile will be upscaled by the browser and appear blurry on retina screens.
- **Suggested fix:** Change `canvas.getContext('2d')` to `canvas.getContext('2d', { alpha: false, desynchronized: true })`. The main thread should transfer the canvas already sized at `Math.floor(tileSize * dpr)` and pass `dpr` in the payload; the worker then calls `context.scale(dpr, dpr)` before rendering so the tile is sharp on high-DPI displays.

### [LOW · conf 0.92] PDFPageCanvas: `renderQueue.sort()` on every dequeue even when only one item is queued
- **File:** `src/components/PDFPageCanvas.jsx` @ lines 28-40 (processRenderQueue / global renderQueue)
- **Problem:** `processRenderQueue` sorts the entire global `renderQueue` array on every call to `processRenderQueue` (line 30), including when the queue has 0 or 1 items. `processRenderQueue` is called from `enqueueRender` (on every new page entering view) and from the `finally` block of each completed render. On a 200-page PDF scrolled rapidly, this is O(n log n) sorting that re-runs for every render completion even when the queue only holds one pending item.
- **Suggested fix:** Guard the sort with `if (renderQueue.length > 1) renderQueue.sort(...)`, or switch to a sorted-insert strategy: insert each new item at the correct priority position in `enqueueRender` instead of sorting on dequeue.


## DB-SYNC (5)

### [MEDIUM · conf 0.9] crdtBackfill fallback SELECT loop uses SELECT * instead of the narrowed column projection
- **File:** `src/lib/collab/crdtBackfill.js` @ line 553-559 — `.select('*')` inside the OFFSET-paginated fallback loop
- **Problem:** When `args.existingHydrateRows` is NOT threaded in (cold open without YDocProvider, tests, any non-YDocProvider caller), the fallback SELECT loop at line 553 still uses `.select('*')`. The authoritative hydrate reader in `annotationCloudSync.js` already pins a lean `ANNOTATION_READ_COLUMNS` projection (`id, user_id, annotation_id, annotation_type, page_number, annotation_data, created_at, updated_at`) specifically to avoid pulling the duplicate `bounds` geometry blob and ~15 unused scalar columns. The backfill loop deserializes and discards those extra columns anyway, so every extra byte pulled over the wire from Postgres is pure waste. On a 22 k-row document this can be several MB of extra JSON per page of the pagination loop.
- **Suggested fix:** Define a matching `BACKFILL_READ_COLUMNS` constant mirroring `ANNOTATION_READ_COLUMNS` and use it in the fallback SELECT loop: `.select(BACKFILL_READ_COLUMNS)`. The deserialization path (`deserializeRowDefensive`) only touches the same fields the hydrate projection exposes, so the change is safe.

### [MEDIUM · conf 0.85] pushHistoryDebugEvent fires a bare-Supabase upsert on every undo/redo/checkpoint event with no debounce or coalescing
- **File:** `src/PDFViewer.jsx` @ lines 9527-9543 — `pushHistoryDebugEvent` → `recordDocumentHistoryEvent`
- **Problem:** `pushHistoryDebugEvent` is called on every `checkpoint_added`, `checkpoint_added_annotation_fast`, `local_annotation_history_added`, undo-applied, and redo-applied event. Each call unconditionally fires `void recordDocumentHistoryEvent(historyRow)`, which issues a Supabase upsert to `document_history_events`. During a fast drawing session (rapid strokes, rapid undo/redo, counter placement) this can generate a burst of sequential upserts — potentially dozens per second. There is no debounce, no batching, and no coalescing: each event lands as its own independent round-trip. The `document-history:event-recorded` custom event is dispatched first (optimistic local update), so debouncing the Supabase write would not affect the UI.
- **Suggested fix:** Debounce the `recordDocumentHistoryEvent` call with a trailing 1–2 second window, or collect events into a micro-batch and flush the batch as a single multi-row upsert. Since `ignoreDuplicates: true` is already set on the upsert conflict target `(document_id, client_event_id)`, batching multiple rows into one `.upsert(rows)` call is safe and idempotent.

### [MEDIUM · conf 0.8] countSurveyMarkersReferencingChecklistItemFallback fetches up to 5 000 full annotation_data blobs to count one key
- **File:** `src/services/documentAnnotationService.js` @ lines 243-263 — `countSurveyMarkersReferencingChecklistItemFallback`
- **Problem:** When the `cs` (contains) server-side filter fails, the fallback fetches up to 5 000 rows of `annotation_data` (full JSONB payloads) from Supabase and counts matching `checklistResponses` keys in JavaScript. For a large survey with many markers this can transfer several MB of JSONB over the wire and hold the JS thread for a visible moment, yet the result is a single integer. The primary path returns `count` from a `{ count: 'exact', head: true }` query (no rows transferred at all). The fallback inverts this: maximum bytes for minimum value.
- **Suggested fix:** Use a Postgres `jsonb_exists` or `?` operator filter directly on `annotation_data->'checklistResponses'` with `head: true` and `count: 'exact'`, adding a `.containedBy` or `.filter` clause that matches any object containing the key — this keeps zero rows on the wire. Alternatively, push a lightweight RPC that does the `jsonb ?` check server-side so the fallback never needs client-side counting.

### [LOW · conf 0.85] getDocumentPresence uses SELECT * on document_presence when the downstream consumer needs only a few columns
- **File:** `src/services/documentAnnotationService.js` @ lines 600-618 — `getDocumentPresence`
- **Problem:** `getDocumentPresence` fetches presence rows with `.select('*')`. The downstream consumer (`presenceRoster.js` / `useDocumentPresenceList`) only reads `user_id`, `display_name`, `current_page`, `last_seen`, and `client_type`. Pulling `cursor_position` (a geometry/JSON column), `selected_annotation_id`, and any other wide columns is wasted bandwidth on every initial-seed and reconnect-reseed. In a document with many concurrent collaborators this amplifies the payload.
- **Suggested fix:** Narrow the projection to the columns actually consumed: `user_id, display_name, current_page, last_seen, client_type`. This is a one-line change and has no correctness risk since all consumed fields are explicitly enumerated.

### [LOW · conf 0.75] resendDocumentInvite issues a redundant SELECT after the RPC to reload the invite row that the RPC already touched
- **File:** `src/services/documentInviteService.js` @ lines 125-149 — `resendDocumentInvite`
- **Problem:** `resendDocumentInvite` calls `supabase.rpc('kal31_resend_document_invite', …)` and then immediately issues a separate `SELECT * FROM document_invites WHERE id = inviteId` to reload the row so it can extract `target_email`, `token`, and `intended_role` for the email. The RPC already modified that row and has access to it server-side; the data needed for the email (`target_email`, `token`, `intended_role`) could be returned directly from the RPC's return value rather than requiring a second round-trip.
- **Suggested fix:** Modify `kal31_resend_document_invite` to return the updated invite row (or at minimum `target_email`, `token`, `intended_role`, `expires_at`). On the client side, consume `data` from the RPC result directly instead of re-querying. This eliminates one round-trip per resend action.


## REACT-PERF (9)

### [HIGH · conf 0.9] YDocProvider on first-paint path statically pulls yjs + y-protocols + lib0 (~8.5 MB source) before any PDF is opened
- **File:** `src/AppShell.jsx` @ line 24: import YDocProvider from './components/collab/YDocProvider.jsx'
- **Problem:** AppShell statically imports YDocProvider (DO-NOT-AUTO-EDIT), which itself statically imports `import * as Y from 'yjs'` plus SupabaseYjsProvider (which imports `y-protocols/sync`, `y-protocols/awareness`, `lib0/encoding`, `lib0/decoding`). Combined source size: yjs 2.5 MB, y-protocols 1.1 MB, lib0 4.9 MB. YDocProvider is only rendered inside PDF tabs (AppShell line 2389) — it is never visible on the home/dashboard screen. Deferring it behind the same lazy boundary as PDFViewer would eliminate these CRDT libraries from the entry chunk.
- **Suggested fix:** Surface only — AppShell.jsx and YDocProvider.jsx are both in DO-NOT-AUTO-EDIT. A human reviewer should consider moving `<YDocProvider>` inside the lazy PDFViewer chunk (or adding a dynamic import boundary in AppShell so YDocProvider and PDFViewer share a deferred chunk). The fix requires careful testing of the per-tab Y.Doc lifecycle and the 'pitfall 21' registry contract described in YDocProvider.jsx.

### [MEDIUM · conf 0.97] Non-passive document scroll listeners in context-menu and edit-modal dismiss effects (surface only)
- **File:** `src/PageAnnotationLayer.jsx` @ lines 4904 and 4923
- **Problem:** Two useEffect blocks that dismiss the context menu and edit modal on scroll register document.addEventListener('scroll', handleScrollOrWheel, true) using a bare boolean true (capture-only). Neither closeContextMenu nor dismissEditModal calls preventDefault. The scroll event handler cannot be moved to the compositor thread, introducing latency on every scroll tick while either overlay is open.
- **Suggested fix:** Replace the boolean true with { capture: true, passive: true } on both calls:
  document.addEventListener('scroll', handleScrollOrWheel, { capture: true, passive: true });
Update the matching removeEventListener calls accordingly (they currently pass true, which also needs to become { capture: true } to match). DO NOT auto-apply — file is in the DO-NOT-AUTO-EDIT list.

### [MEDIUM · conf 0.88] SearchHighlightLayer.jsx: CSS animation declared inside <svg><defs><style> — blocks GPU compositing
- **File:** `src/components/SearchHighlightLayer.jsx` @ lines 257–297 — `<svg …><defs><style>{ @keyframes search-active-highlight-pulse … }</style></defs>` with `animation: search-active-highlight-pulse 1.05s ease-in-out infinite alternate` applied to `<rect>` children
- **Problem:** The pulsing highlight animation (`@keyframes search-active-highlight-pulse`) is defined inside `<defs><style>` within the `<svg>` element, and the class `.search-highlight-svg-active-pulse` that runs it is applied to `<rect>` SVG children. The browser compositor cannot promote SVG children to their own GPU layer for CSS animations; instead, the entire SVG subtree must be repainted on every animation frame (~60×/s), forcing layout/paint work each tick when a search match is active.
- **Suggested fix:** Replace the SVG-internal animation with a positioned `<div>` overlay that is rendered only for the active/pulsing match and animates via CSS `opacity` on a real HTML element (which IS eligible for GPU-layer promotion). The non-animated highlight rectangles stay in the SVG. Move `@keyframes` to a module-level `<style>` injected once, or to a CSS file. Example: alongside the `<svg>`, render `{shouldPulse && <div className="search-pulse-overlay" style={{ position:'absolute', left: rect.x * scale, top: rect.y * scale, width: rect.width * scale, height: rect.height * scale }} />}` and animate that `<div>` with `will-change: opacity`.

### [LOW · conf 0.95] Non-passive container scroll listener in view-state emit effect (surface only)
- **File:** `src/PDFViewer.jsx` @ line 4721
- **Problem:** container.addEventListener('scroll', debouncedHandleScroll) registers without { passive: true }. debouncedHandleScroll only reads containerRef.current.scrollLeft / scrollTop and debounces an onViewStateChange call — it never calls preventDefault. The browser cannot schedule this as a passive scroll notification, adding overhead on every scroll tick in the PDF viewer.
- **Suggested fix:** Change to: container.addEventListener('scroll', debouncedHandleScroll, { passive: true }); DO NOT auto-apply — file is in the DO-NOT-AUTO-EDIT list.

### [LOW · conf 0.9] sortedMembers() not memoized — Date.parse() called O(n log n) times per render in sort comparator
- **File:** `src/home/ManageTeamModal.jsx` @ ManageTeamModal component, sortedMembers() at line 178, called at line 207
- **Problem:** `sortedMembers()` is a plain function (not `useMemo`) called unconditionally on every render. It calls `Date.parse(a.added)` and `Date.parse(b.added)` inside the sort comparator, which means each item's `added` string is re-parsed for every comparison — O(n log n) parse calls instead of O(n). Any state change (e.g. openMenu, openRoleSel) re-triggers this.
- **Suggested fix:** Wrap `sortedMembers` in `useMemo` with deps `[memberList, sortKey, sortDir]`. Inside, pre-compute timestamps before sorting: `const withMs = memberList.map(m => ({ ...m, _addedMs: Date.parse(m.added) })); const arr = withMs.slice(); arr.sort((a, b) => { if (sortKey === 'added') return sign * (a._addedMs - b._addedMs); ... });`

### [LOW · conf 0.9] .map().filter(Boolean).map() — three passes over bboxes in selection rendering
- **File:** `src/components/SVGAnnotationLayer.jsx` @ lines 5036-5039 — bboxes computation in the multi-selection group frame render path
- **Problem:** `Array.from(selectedIds).map(…).filter(Boolean).map(getAnnotationWorldAABB)` runs three passes over the selected-annotation set on every render where a multi-selection is active. In the annotation SVG layer this re-runs whenever any annotation or zoom/scroll state changes.
- **Suggested fix:** Collapse to a single reduce:
```js
const bboxes = [];
for (const idx of selectedIds) {
  const obj = visualTransform?.previewObjects?.[idx] || annotations?.objects?.[idx];
  if (obj) bboxes.push(getAnnotationWorldAABB(obj));
}
```
NOTE: SVGAnnotationLayer.jsx is in DO-NOT-AUTO-EDIT — surface only, do not apply.

### [LOW · conf 0.88] regions.find() inside for-loop over selectedRegionIds — O(n×m) lookup without Map
- **File:** `src/RegionSelectionTool.jsx` @ lines 1054-1055 — mousedown handler: for (const regionId of selectedRegionIds) { const region = regions.find(r => r.regionId === regionId) }
- **Problem:** On every mousedown in move-tool mode, `regions.find(r => r.regionId === regionId)` is called once per selected region, making the total cost O(|regions| × |selectedRegionIds|). No pre-built Map or index exists for `regionId` on the regions array.
- **Suggested fix:** Build a Map once before the loop (or keep it memoized above):
```js
const regionById = new Map(regions.map(r => [r.regionId, r]));
for (const regionId of selectedRegionIds) {
  const region = regionById.get(regionId);
  ...
}
```
NOTE: RegionSelectionTool.jsx is in DO-NOT-AUTO-EDIT — surface only, do not apply.

### [LOW · conf 0.8] Array.includes() inside filter/map on selectedIds Array — should be a Set
- **File:** `src/Dashboard.jsx` @ lines 1421, 1456, 1522, 1526, 1550, 1597, 1599, 1604, 1609, 1614, 1636, 1641, 1651, 1655, 1720, 1724 — event handlers that filter/map documents, projects, templates using selectedIds.includes()
- **Problem:** `selectedIds` is typed as `useState([])` (an Array, line 363). Every bulk operation (delete, share, move/copy) calls `.filter(d => !selectedIds.includes(d.id))` or `.map(d => selectedIds.includes(d.id) ? ... : d)` against the full documents/projects/templates array, making each operation O(n×m) where m is the selection count. With multi-select over large lists this is noticeable.
- **Suggested fix:** Change `const [selectedIds, setSelectedIds] = useState([])` to `useState(new Set())` and update all call-sites that push/remove ids to use Set operations (`add`, `delete`, spread). Each `.includes()` then becomes `.has()` in O(1).

### [LOW · conf 0.75] orderedSpaces list in SpacesPanel rendered without content-visibility
- **File:** `src/sidebar/SpacesPanel.jsx` @ lines 1596–1668, orderedSpaces.map() inside overflowY:auto container
- **Problem:** orderedSpaces.map() renders one SpaceSortableCard per space into a scrollable container (line 1572 overflowY: auto). No content-visibility is applied to the per-row wrapper. For projects with many spaces (tens or more), all SpaceSortableCard subtrees are laid out and painted on every re-render even when scrolled out of view.
- **Suggested fix:** Add `contentVisibility: 'auto'` to the SortableRearrangeRow's inner content wrapper (the div returned inside the render prop at line 1611), with a `containIntrinsicSize` matching the approximate card height. The SortableRearrangeRow itself must remain visible for DnD-kit geometry, so target the inner content `div` or SpaceSortableCard root.
