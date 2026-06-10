# PLAN-BL23 — Templates editor: background template refresh wipes in-progress category renames

_Round 3 revision — after Codex review rounds 1-3._

Task-scoped plan file (root PLAN.md is the governing Excel-sync contract — untouched).
Board file: `BL-23 templates-editor-refresh-wipes-category-renames.md`. Backlog detail:
`.planning/optimization/BACKLOG-not-yet-in-linear.md` (BL-23 entry).

## Problem (verified in current code, 2026-06-10)

Defects in `src/home/TemplatesEditor.jsx` plus one verified host-contract gap in
`src/Dashboard.jsx` (the live host: `Dashboard` → `SurveyHub` → `TemplatesEditor`):

**(a) No dirty guard on prop reload.** `reloadFromProps` (818-834) rebuilds the whole
working copy whenever the `templates` prop identity changes — and the host's
`templates` useMemo (Dashboard.jsx:222) republishes on any background refetch.
Committed-but-unsaved edits are silently discarded.

**(b) Empty rename silently rejected with no feedback.** `renameCategory` (1054) does
`if (!v) return`; the uncontrolled input (`key={c.id + ':' + c.name}`, 1621-1631)
keeps showing the cleared value while the model retains the old name. ALSO (Codex r1):
blurring with an UNCHANGED name still calls `mutateOpenModule` → `mutateTpl` →
`setDirty(true)` unconditionally — a no-op blur dirties the editor, which matters once
dirty gates reloads. Same for the Escape path (Escape restores the value, then blur
commits the identical name → spurious dirty).

**(c) Legacy id-less rows get fresh ids every rebuild.** `buildRich` (279-328) mints
`newId(...)` for rows lacking a persisted `id`; every rebuild (including today's
mount + effect double-build) re-mints → keyed inputs remount → uncommitted typing
wiped. `richToTemplate` persists ids on save, so this hits templates never re-saved.

**(d) Save failures are swallowed end-to-end (verified Codex r1 finding).**
`persistTemplates` (Dashboard.jsx:1148-1214) catches every per-row error AND the
outer error and never rethrows; `hubSaveTemplates` (3114-3128) alerts but does not
rethrow. The editor's `handleSaveTemplates` clears `dirty` synchronously. Net: a
failed save clears dirty, the refetch republishes the OLD rows, and (with or without
the new guard) the user's "saved" edits silently vanish. The editor cannot detect
failure under the current host contract.

## Fix design

### New leaf util: `src/home/templatesEditorReload.js`

Dependency-free (zero imports) so Node tests exercise the REAL module. Exports:

1. `resolveTemplatesReload({ dirty, prevRich, nextRich })` →
   `{ mode: 'replace' }` when `!dirty`; `{ mode: 'append', appended }` when dirty and
   nextRich has template ids absent from prevRich (host-created "New Template" still
   appears); `{ mode: 'keep' }` otherwise (the wipe-prevention case).

2. `createStableIdMint(cache, makeId)` → `(key, prefix) => id` — cached structural-key
   minting so id-less legacy rows keep one id per session (fixes (c)).

3. `createOccurrenceKeyer()` → `(scopeKey, label) => key` — builds SEMANTIC cache keys
   as `JSON.stringify([scopeKey, label, occurrence])` (occurrence = nth sibling with
   that label in that scope, counted per rebuild pass). JSON-array keying is
   collision-proof against `|`/`#` characters in user-entered names (Codex r3). Codex r1: positional keys mis-attach ids when a
   row is inserted/removed remotely; name+occurrence keys survive insertion. A rename
   of an id-less row changes its key (fresh id) — harmless, the input's name-bearing
   React key remounts it anyway.
   DOCUMENTED LIMIT (Codex r2): rows with IDENTICAL labels are disambiguated only by
   occurrence order, so inserting a same-label row above an id-less same-label row
   shifts the suffix and re-mints ids for the later duplicates. Requires duplicate
   names + id-less legacy rows + a remote same-label insertion mid-typing — accepted
   and tested as stated behavior; neighbor-aware reconciliation is not worth the
   complexity for that corner.

4. `seedColorMaps(richTemplates)` → `{ roleColors, borderColors, matchFill }` —
   extraction of the seeding loop in reloadFromProps (820-825), reused by the
   full-reload and append paths.

5. `resolveTitleCommit(rawValue, currentName)` →
   - `{ action: 'restore', name: currentName }` — trimmed value empty (visible
     snap-back is the feedback);
   - `{ action: 'noop', name: currentName }` — trimmed value === currentName: the
     canonical CURRENT name comes back so the caller normalizes whitespace-only
     variants in the input (Codex r2: return shape made explicit); no mutator call,
     no spurious dirty; also makes Escape-then-blur clean;
   - `{ action: 'commit', name: trimmed }` — otherwise.

### `src/home/TemplatesEditor.jsx` changes (minimum viable diff)

1. `buildRich(templates, mint?)` — optional mint param defaulting to
   `(_key, prefix) => newId(prefix)` (behavior identical when omitted). The four
   `?? newId(...)` sites become `?? mint(semanticKey, prefix)` where semanticKey comes
   from `createOccurrenceKeyer()` instantiated per buildRich pass:
   template scope = `t?.id ?? 't' + i` (the existing rich-id fallback, unchanged),
   module key = keyer(tplScope, `m:${name}`), category = keyer(modKey, `c:${name}`),
   item = keyer(catKey, `i:${text}`), entity = keyer(tplScope, `e:${role}`).

2. Stable mint via lazy ref init (no per-render identity churn, no effect-dep trap —
   Codex r1 finding 1): declared BEFORE the `rich` state so the useState initializer
   can use it:
   ```js
   const mintIdRef = useRef(null);
   if (mintIdRef.current === null) mintIdRef.current = createStableIdMint(new Map(), newId);
   const mintId = mintIdRef.current;
   ```
   `reloadFromProps` passes `mintId` to `buildRich`; `mintId` is referentially stable
   so adding it to the useCallback deps changes nothing.

3. Reload effect — NO render-phase ref writes (Codex r1 finding 2). The guard ref is
   written only inside the effect. `reloadFromProps`'s useCallback identity changes
   exactly when (templates, user) change, so it doubles as the snapshot key:
   ```js
   /* Identity of the last (templates, user) snapshot synced into the working copy. */
   const lastSyncedReloadRef = useRef(null);
   useEffect(() => {
     if (lastSyncedReloadRef.current === reloadFromProps) return; // snapshot handled
     lastSyncedReloadRef.current = reloadFromProps;
     if (!dirty) { reloadFromProps(); return; }
     /* Unsaved edits: never rebuild over them; only append templates new to the copy. */
     const next = buildRich(applyTemplateOrderPreference(templates, user), mintId);
     const res = resolveTemplatesReload({ dirty: true, prevRich: rich, nextRich: next });
     if (res.mode !== 'append') return;
     setRich((prev) => {
       const have = new Set(prev.map((t) => t.id));
       const add = res.appended.filter((t) => !have.has(t.id));
       return add.length ? [...prev, ...add] : prev;
     });
     const seeded = seedColorMaps(res.appended);
     setRoleColors((prev) => ({ ...seeded.roleColors, ...prev }));
     setBorderColors((prev) => ({ ...seeded.borderColors, ...prev }));
     setMatchFill((prev) => ({ ...seeded.matchFill, ...prev }));
   }, [reloadFromProps, dirty, rich, templates, user, mintId]);
   ```
   Reruns triggered by `dirty`/`rich` changes hit the snapshot guard and return —
   lint-clean deps with no loop. Walked sequences:
   - Background refetch while dirty, no new ids → keep (the BL-23 fix).
   - Background refetch while clean → full reload, exactly today's behavior.
   - Save success: host `updateTemplates` + refetch republish while dirty is still
     true → append-branch keeps the (identical) working copy; promise then resolves →
     dirty false → guard skips. End state consistent (working copy === saved rows).
   - Save failure (with (d) fixed): dirty never cleared → edits + Save bar preserved.
   - Dirty + host-created template → appended while edits persist.
   - `handleCancelEdits` still calls `reloadFromProps()` directly (explicit intent);
     a subsequent guarded rerun is a no-op either way.

4. `reloadFromProps` body: use `seedColorMaps`, pass `mintId`. Otherwise identical.

5. Category title input onBlur (1628):
   ```js
   onBlur={(e) => {
     const r = resolveTitleCommit(e.currentTarget.value, c.name);
     if (r.action === 'commit') renameCategory(i, r.name);
     e.currentTarget.value = r.name;
   }}
   ```
   `renameCategory` keeps its empty guard (defense in depth). Sibling rename inputs
   (template 1470, module 427/2132, entity 1878, item 1687) share the pattern but have
   their own semantics (items may be legitimately empty) — follow-up note on the
   board, NOT changed here.

6. `handleSaveTemplates` (1298-1306): clear dirty only when the save resolves AND no
   newer edit happened while the save was in flight (Codex r3: otherwise a resolve
   from an older save clears dirty over newer unsaved edits, and the next refetch
   wipes them). An edit-revision counter, bumped on every dirtying mutation, makes
   the clear conditional:
   ```js
   const editRevisionRef = useRef(0);
   const markEdited = useCallback(() => { editRevisionRef.current += 1; setDirty(true); }, []);
   // every existing `setDirty(true)` mutation site (mutateTpl, duplicateTemplates, …)
   // switches to markEdited(); save-failure handlers use the revision-conditional
   // `if (editRevisionRef.current === rev) setDirty(true)` (Codex r4).

   const handleSaveTemplates = () => {
     if (!onSaveTemplates) { setDirty(false); return; }
     const rev = editRevisionRef.current;
     Promise.resolve(onSaveTemplates(rich.map(richToTemplate)))
       .then(() => { if (editRevisionRef.current === rev) setDirty(false); })
       .catch((err) => {
         console.error('Failed to save templates', err);
         if (editRevisionRef.current === rev) setDirty(true);
       });
   };
   ```
   The catch is ALSO revision-conditional (Codex r4): if a newer edit/save superseded
   this dispatch, the stale failure must not re-dirty an editor whose newer save
   already succeeded (when newer edits exist unsaved, dirty is already true via
   markEdited, so nothing is lost).
   The Save bar stays up during the in-flight save (honest) and after a failure
   (recoverable — user can retry; alert from the host explains).

6b. `deleteTemplates` (957-968) gets the SAME treatment (Codex r2: it had the same
   sync dirty-clear race) — and the save call moves OUT of the setRich updater
   (side effects inside a state updater are the impure-updater footgun Codex flagged
   in BL-22 r2; StrictMode double-invokes updaters → double save):
   ```js
   const deleteTemplates = (ids) => {
     const next = rich.filter((t) => !ids.has(t.id));
     markEdited();                      // a delete IS an edit (Codex r4): dirty=true
     setRich(next);                     // during the in-flight save, so a background
     if (onSaveTemplates) {             // refetch can't full-reload and resurrect
       const rev = editRevisionRef.current;  // captured AFTER the bump
       Promise.resolve(onSaveTemplates(next.map(richToTemplate)))
         .then(() => { if (editRevisionRef.current === rev) setDirty(false); })
         .catch((err) => {
           console.error('Failed to delete templates', err);
           if (editRevisionRef.current === rev) setDirty(true);
         });
     } else {
       setDirty(false);
     }
   };
   ```
   (`rich` is current in the handler's render scope — deletion is user-initiated.
   Same revision-conditional clear AND catch as handleSaveTemplates.)

### `src/Dashboard.jsx` changes (host error contract — Codex r1 findings 3/4)

7. `persistTemplates` (1148): count per-row failures (delete/update/create catches
   increment a counter; keep logging); after the refetch, `if (failures) throw new
   Error(\`\${failures} template(s) failed to save\`)`. The refetch still runs first so
   whatever DID persist syncs. The OUTER catch (1211-1213) now rethrows after logging
   (Codex r2: otherwise refetch/unexpected errors stay swallowed and the failure
   counter never propagates). Two callers verified:
   - `hubSaveTemplates` (3114): add `throw e;` at the end of its catch (after the
     existing alert) so the editor's `.catch` fires and dirty is restored.
   - the template-modal save (~3064): its existing catch (3078) logs and keeps the
     modal open on failure — an acceptable, strictly-better behavior change.

## Out of scope (explicit accepted limitations)

- **Remote-delete resurrection / remote-edit overwrite while dirty** (Codex r1
  findings 5/6): with the guard, a template deleted or edited remotely while the user
  has unsaved edits is restored/overwritten by the user's Save (full-working-copy,
  last-writer-wins — today's Save semantics). Today's alternative is silently wiping
  the ACTIVE user's edits, which is strictly worse. Real conflict handling
  (updatedAt/hash detection, merge prompts) needs a product decision — queued for
  Isaiah on the board; not attempted per loop rules.
- Toast/banner for rejected empty titles (design decision — queued).
- Sibling rename inputs — follow-up note on the board.
- Component-mount (jsdom/RTL) tests: no component-test infra exists in this repo
  (node:test only, no jsdom/@testing-library in package.json); introducing that stack
  is its own task. Coverage below follows the repo's established pattern
  (real-module behavior tests + source tripwire tests, per BL-22/KAL-43).

## Tests — `tests/templatesEditorReloadGuard.test.mjs`

node:test + assert/strict. Part A imports the REAL `src/home/templatesEditorReload.js`:

1. `resolveTemplatesReload`: not dirty → replace; dirty + same ids → keep; dirty +
   new template id → append (appended exactly the new objects, prevRich untouched);
   dirty + remotely-removed template → keep (deletion deferred).
2. `createStableIdMint`: same key → identical id across calls; distinct keys →
   distinct ids; uses injected makeId.
3. `createOccurrenceKeyer`: same scope+label twice → `#0`, `#1`; insertion-before
   scenario — two passes where pass 2 inserts a new DISTINCT-label first row:
   surviving rows keep their keys (and thus their minted ids), the inserted row gets
   a fresh key. SAME-label insertion (Codex r2): two passes where pass 2 inserts an
   identical label above — assert the documented limit (later duplicates shift to new
   occurrence keys → re-minted ids), so the behavior is pinned, not accidental.
4. `resolveTitleCommit`: empty → restore; whitespace → restore; unchanged → noop with
   `name === currentName`; whitespace-around-unchanged ("  Doors  " vs "Doors") →
   noop returning the canonical current name; new value → commit trimmed.
5. `seedColorMaps`: color + 0.35 default opacity; borderColor only when present
   (borderOpacity fallback chain); matchFill only when truthy.

Part B — source tripwires over `src/home/TemplatesEditor.jsx` (and Dashboard.jsx),
mirror of the BL-22 pattern:

6. Reload effect: contains the `lastSyncedReloadRef` guard and the dirty branch
   calling `resolveTemplatesReload`; exactly zero remaining bare
   `useEffect(() => { reloadFromProps(); }` wiring.
7. Category input onBlur uses `resolveTitleCommit`; no other category-title path
   calls `renameCategory` with a raw event value.
8. `buildRich` signature accepts the mint param and all four legacy-mint sites call it.
9. `handleSaveTemplates` has no synchronous `setDirty(false)` after the
   onSaveTemplates call (clear lives in `.then`).
9b. `deleteTemplates`: no synchronous `setDirty(false)`; clear lives in `.then`,
    restore in `.catch`; no `onSaveTemplates` call inside a `setRich` updater
    anywhere in the file (impure-updater tripwire).
9c. Revision race: `markEdited` bumps `editRevisionRef` and is the only dirtying
    path for mutations (zero remaining bare `setDirty(true)` outside markEdited
    itself); both save paths capture `rev` and BOTH their `.then` and `.catch`
    are revision-conditional; `deleteTemplates` calls `markEdited()` before
    capturing `rev`.
3b. `createOccurrenceKeyer` keys are JSON arrays — a label containing `|`/`#`
    cannot collide with a sibling scope/label combination (explicit collision test).
10. Dashboard tripwires: `persistTemplates` counts failures and throws; its outer
    catch rethrows; `hubSaveTemplates` rethrows from its catch.

## Acceptance Criteria

- **Given** unsaved edits (dirty), **when** the host republishes the templates prop,
  **then** the working copy is unchanged and the Save bar stays up.
- **Given** unsaved edits, **when** the host republishes with a brand-new template id,
  **then** that template appears appended while local edits persist.
- **Given** a clean editor, **when** the prop republishes, **then** full reload exactly
  as today.
- **Given** a category title cleared to empty, **when** the input blurs, **then** the
  old name visibly snaps back (no silent empty field).
- **Given** a blur with an unchanged title (including after Escape), **then** the
  editor does NOT become dirty.
- **Given** an id-less legacy category, **when** the prop republishes repeatedly while
  clean — including with a DISTINCT-label row inserted above it — **then** it keeps
  its minted id (no input remount; uncommitted typing survives). Same-label
  insert/delete/reorder churns occurrence suffixes for the later duplicates — the
  documented, test-pinned limit.
- **Given** an edit made while a Save/Delete is still in flight, **when** that older
  save resolves, **then** dirty stays true (revision counter mismatch) and the newer
  edits are not exposed to a reload wipe.
- **Given** a save where any row fails to persist, **when** the promise chain settles,
  **then** dirty stays true, the working copy keeps the edits, and the user is alerted.
- **Given** the gates, **then** `npx vite build` passes and
  `node scripts/run-node-tests.mjs` reports 0 failures (baseline 1368 / 6 skipped).

## DO NOT CHANGE

- `src/PDFViewer.jsx`, `src/PageAnnotationLayer.jsx`, `src/viewerShared.js`,
  `src/components/Fabric*.jsx`, `src/components/SVGAnnotationLayer.jsx` — high-risk
  viewer files, untouched by this task.
- `PLAN.md` (root) — governing Excel-sync contract.
- Save/cancel UX shapes beyond the dirty-clear timing; `renameCategory` guard
  semantics for non-empty names.
- Sibling rename inputs (template/module/entity/item) — follow-up only.
- In `src/Dashboard.jsx`: only `persistTemplates` + `hubSaveTemplates` catch blocks —
  no other handler, no state shape, no template-modal logic.
