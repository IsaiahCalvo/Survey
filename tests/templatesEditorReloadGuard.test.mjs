// BL-23 — Templates editor: background template refresh must not wipe
// in-progress category renames.
//
// Part A exercises the REAL pure module (src/home/templatesEditorReload.js —
// dependency-free precisely so Node can import it; component files resolve
// only under vite). Part B is source tripwires over TemplatesEditor.jsx and
// Dashboard.jsx pinning the wiring the pure tests can't reach (the effect
// guard, blur handling, mint plumbing, dirty-clear timing, and the host's
// throw-on-failure contract), mirroring the BL-22 pattern.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  resolveTemplatesReload,
  createStableIdMint,
  createOccurrenceKeyer,
  seedColorMaps,
  resolveTitleCommit,
} from '../src/home/templatesEditorReload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const editorSrc = readFileSync(path.join(__dirname, '../src/home/TemplatesEditor.jsx'), 'utf8');
const dashboardSrc = readFileSync(path.join(__dirname, '../src/Dashboard.jsx'), 'utf8');

/* ---------------- Part A — real-module behavior ---------------- */

test('BL-23 resolveTemplatesReload: clean editor always replaces (pre-fix behavior preserved)', () => {
  const prev = [{ id: 'a' }];
  const next = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(resolveTemplatesReload({ dirty: false, prevRich: prev, nextRich: next }), { mode: 'replace' });
  // even with no changes at all
  assert.deepEqual(resolveTemplatesReload({ dirty: false, prevRich: prev, nextRich: prev }), { mode: 'replace' });
});

test('BL-23 resolveTemplatesReload: dirty + identical ids keeps the working copy (the wipe-prevention case)', () => {
  const prev = [{ id: 'a' }, { id: 'b' }];
  const next = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(resolveTemplatesReload({ dirty: true, prevRich: prev, nextRich: next }), { mode: 'keep' });
});

test('BL-23 resolveTemplatesReload: dirty + new template id appends exactly the new objects', () => {
  const prev = [{ id: 'a', name: 'edited locally' }];
  const fresh = { id: 'b', name: 'host-created' };
  const next = [{ id: 'a', name: 'remote variant' }, fresh];
  const res = resolveTemplatesReload({ dirty: true, prevRich: prev, nextRich: next });
  assert.equal(res.mode, 'append');
  assert.equal(res.appended.length, 1);
  // reference equality into nextRich — the existing (locally edited) template is untouched
  assert.equal(res.appended[0], fresh);
  assert.equal(prev[0].name, 'edited locally');
});

test('BL-23 resolveTemplatesReload: dirty + remotely-removed template keeps (deletion deferred to Save/Cancel)', () => {
  const prev = [{ id: 'a' }, { id: 'b' }];
  const next = [{ id: 'a' }]; // b deleted remotely
  assert.deepEqual(resolveTemplatesReload({ dirty: true, prevRich: prev, nextRich: next }), { mode: 'keep' });
});

test('BL-23 createStableIdMint: same key returns the identical id across calls', () => {
  let n = 0;
  const mint = createStableIdMint(new Map(), (prefix) => `${prefix}_${n++}`);
  const first = mint('K1', 'c');
  assert.equal(mint('K1', 'c'), first);
  assert.equal(mint('K1', 'c'), first);
  const other = mint('K2', 'c');
  assert.notEqual(other, first);
  assert.match(first, /^c_/);
});

test('BL-23 createStableIdMint: uses the injected makeId', () => {
  const mint = createStableIdMint(new Map(), () => 'CANARY');
  assert.equal(mint('x', 'c'), 'CANARY');
});

test('BL-23 createOccurrenceKeyer: same scope+label gets occurrence 0, 1, …', () => {
  const keyer = createOccurrenceKeyer();
  assert.equal(keyer('scope', 'c:Doors'), JSON.stringify(['scope', 'c:Doors', 0]));
  assert.equal(keyer('scope', 'c:Doors'), JSON.stringify(['scope', 'c:Doors', 1]));
  assert.equal(keyer('scope', 'c:Windows'), JSON.stringify(['scope', 'c:Windows', 0]));
});

test('BL-23 keyer+mint: distinct-label insertion above keeps surviving rows\' minted ids', () => {
  let n = 0;
  const cache = new Map();
  const mint = createStableIdMint(cache, (p) => `${p}_${n++}`);
  // pass 1: [Doors, Windows] (both id-less)
  const k1 = createOccurrenceKeyer();
  const doors1 = mint(k1('m', 'c:Doors'), 'c');
  const windows1 = mint(k1('m', 'c:Windows'), 'c');
  // pass 2: remote insert of a DISTINCT label above: [Vents, Doors, Windows]
  const k2 = createOccurrenceKeyer();
  const vents2 = mint(k2('m', 'c:Vents'), 'c');
  const doors2 = mint(k2('m', 'c:Doors'), 'c');
  const windows2 = mint(k2('m', 'c:Windows'), 'c');
  assert.equal(doors2, doors1);     // survivors keep their ids → inputs don't remount
  assert.equal(windows2, windows1);
  assert.notEqual(vents2, doors1);
  assert.notEqual(vents2, windows1);
});

test('BL-23 keyer+mint: SAME-label insertion shifts later duplicates (the documented, accepted limit)', () => {
  let n = 0;
  const cache = new Map();
  const mint = createStableIdMint(cache, (p) => `${p}_${n++}`);
  // pass 1: [Doors, Doors]
  const k1 = createOccurrenceKeyer();
  const a1 = mint(k1('m', 'c:Doors'), 'c'); // occurrence 0
  const b1 = mint(k1('m', 'c:Doors'), 'c'); // occurrence 1
  // pass 2: another Doors inserted above: [Doors(new), Doors(a), Doors(b)]
  const k2 = createOccurrenceKeyer();
  const new2 = mint(k2('m', 'c:Doors'), 'c'); // occurrence 0 → reuses a1's id
  const a2 = mint(k2('m', 'c:Doors'), 'c');   // occurrence 1 → reuses b1's id
  const b2 = mint(k2('m', 'c:Doors'), 'c');   // occurrence 2 → fresh
  // Pinned: the suffix shift re-attaches ids by occurrence order.
  assert.equal(new2, a1);
  assert.equal(a2, b1);
  assert.notEqual(b2, a1);
  assert.notEqual(b2, b1);
});

test('BL-23 keyer: labels containing | and # cannot collide across scopes (JSON-array keys)', () => {
  const keyer = createOccurrenceKeyer();
  // crafted to collide under naive `${scope}|${label}#${occ}` string keys
  const a = keyer('s', 'c:A|c:B');
  const keyer2 = createOccurrenceKeyer();
  const b = keyer2('s|c:A', 'c:B');
  assert.notEqual(a, b);
  const keyer3 = createOccurrenceKeyer();
  assert.notEqual(keyer3('s', 'c:A#0'), JSON.stringify(['s', 'c:A', 0]));
});

test('BL-23 resolveTitleCommit: empty and whitespace restore the current name (visible snap-back)', () => {
  assert.deepEqual(resolveTitleCommit('', 'Doors'), { action: 'restore', name: 'Doors' });
  assert.deepEqual(resolveTitleCommit('   ', 'Doors'), { action: 'restore', name: 'Doors' });
  assert.deepEqual(resolveTitleCommit(null, 'Doors'), { action: 'restore', name: 'Doors' });
  assert.deepEqual(resolveTitleCommit(undefined, 'Doors'), { action: 'restore', name: 'Doors' });
});

test('BL-23 resolveTitleCommit: unchanged name is a noop returning the canonical current name', () => {
  assert.deepEqual(resolveTitleCommit('Doors', 'Doors'), { action: 'noop', name: 'Doors' });
  // whitespace-around-unchanged normalizes back to the canonical name
  assert.deepEqual(resolveTitleCommit('  Doors  ', 'Doors'), { action: 'noop', name: 'Doors' });
});

test('BL-23 resolveTitleCommit: real change commits the trimmed name', () => {
  assert.deepEqual(resolveTitleCommit('  Vents ', 'Doors'), { action: 'commit', name: 'Vents' });
});

test('BL-23 seedColorMaps: seeds fill, border (only when present), matchFill (only when truthy)', () => {
  const rich = [{
    roster: [
      { id: 'e1', color: '#112233', opacity: 0.5 },
      { id: 'e2', color: '#445566' }, // no opacity → 0.35 default; no border; no matchFill
      { id: 'e3', color: '#778899', opacity: 0.6, borderColor: '#aabbcc', borderOpacity: 0.7, matchFill: true },
      { id: 'e4', color: '#001122', opacity: 0.4, borderColor: '#334455' }, // borderOpacity falls back to fill opacity
    ],
  }];
  const { roleColors, borderColors, matchFill } = seedColorMaps(rich);
  assert.deepEqual(roleColors.e1, { color: '#112233', opacity: 0.5 });
  assert.deepEqual(roleColors.e2, { color: '#445566', opacity: 0.35 });
  assert.equal(borderColors.e1, undefined);
  assert.equal(borderColors.e2, undefined);
  assert.deepEqual(borderColors.e3, { color: '#aabbcc', opacity: 0.7 });
  assert.deepEqual(borderColors.e4, { color: '#334455', opacity: 0.4 });
  assert.deepEqual(matchFill, { e3: true });
});

/* ---------------- Part B — source tripwires ---------------- */

test('BL-23 tripwire: reload effect is snapshot-guarded and dirty-aware (no bare reload-on-prop-change)', () => {
  assert.match(editorSrc, /lastSyncedReloadRef\.current === reloadFromProps\) return;/);
  assert.match(editorSrc, /lastSyncedReloadRef\.current = reloadFromProps;/);
  assert.match(editorSrc, /if \(!dirty\) \{ reloadFromProps\(\); return; \}/);
  assert.match(editorSrc, /resolveTemplatesReload\(\{ dirty: true/);
  // the old unguarded wiring must be gone
  assert.doesNotMatch(editorSrc, /useEffect\(\(\) => \{ reloadFromProps\(\); \}, \[reloadFromProps\]\)/);
});

test('BL-23 tripwire: category title blur goes through resolveTitleCommit (snap-back + noop)', () => {
  assert.match(editorSrc, /resolveTitleCommit\(e\.currentTarget\.value, c\.name\)/);
  // no remaining direct blur-commit of the raw event value for categories
  assert.doesNotMatch(editorSrc, /onBlur=\{\(e\) => renameCategory\(i, e\.currentTarget\.value\)\}/);
});

test('BL-23 tripwire: buildRich accepts a mint param and every legacy-mint site uses it', () => {
  assert.match(editorSrc, /const buildRich = \(templates, mint = \(_key, prefix\) => newId\(prefix\)\)/);
  assert.match(editorSrc, /m\?\.id \?\? mint\(modKey, 'm'\)/);
  assert.match(editorSrc, /c\?\.id \?\? mint\(catKey, 'c'\)/);
  assert.match(editorSrc, /mint\(keyer\(catKey, `i:\$\{text\}`\), 'i'\)/);
  assert.match(editorSrc, /e\?\.id \?\? mint\(keyer\(tplScope, `e:/);
  // no legacy-row newId fallbacks left inside buildRich's row mapping
  assert.doesNotMatch(editorSrc, /\?\.id \?\? newId\(/);
});

test('BL-23 tripwire: dirty clears only via revision+request-conditional promise handlers in both save paths', () => {
  // handleSaveTemplates and deleteTemplates each: capture rev + req, conditional then + catch
  const revCaptures = editorSrc.match(/const rev = editRevisionRef\.current;/g) || [];
  assert.equal(revCaptures.length, 2);
  const reqCaptures = editorSrc.match(/const req = \+\+saveReqSeqRef\.current;/g) || [];
  assert.equal(reqCaptures.length, 2);
  // both paths dispatch through the serializing chain — never call onSaveTemplates directly
  const chained = editorSrc.match(/dispatchTemplatesSave\(/g) || [];
  assert.equal(chained.length, 2); // the 2 dispatch sites (definition is `= useCallback(`)
  assert.match(editorSrc, /const dispatchTemplatesSave = useCallback\(/);
  const directCalls = editorSrc.match(/Promise\.resolve\(onSaveTemplates\(/g) || [];
  assert.equal(directCalls.length, 1); // only inside dispatchTemplatesSave's run()
  const condClears = editorSrc.match(/\.then\(\(\) => \{ if \(editRevisionRef\.current === rev && saveReqSeqRef\.current === req\) setDirty\(false\); \}\)/g) || [];
  assert.equal(condClears.length, 2);
  const condRestores = editorSrc.match(/if \(editRevisionRef\.current === rev && saveReqSeqRef\.current === req\) setDirty\(true\);/g) || [];
  assert.equal(condRestores.length, 2);
  // no synchronous clear after dispatching a save: the only unconditional
  // setDirty(false) sites are reloadFromProps and the no-handler fallbacks
  const unconditionalClears = editorSrc.match(/setDirty\(false\)/g) || [];
  assert.equal(unconditionalClears.length, 5); // reloadFromProps + 2× no-onSaveTemplates fallback + 2× conditional (then) clears
});

test('BL-23 tripwire: markEdited is the only mutation dirty path; no onSaveTemplates inside a setRich updater', () => {
  assert.match(editorSrc, /const markEdited = useCallback\(\(\) => \{ editRevisionRef\.current \+= 1; setDirty\(true\); \}/);
  // bare setDirty(true) survives only inside the revision-conditional catches
  const bareDirtyTrue = (editorSrc.match(/setDirty\(true\)/g) || []).length;
  const conditionalDirtyTrue = (editorSrc.match(/if \(editRevisionRef\.current === rev && saveReqSeqRef\.current === req\) setDirty\(true\);/g) || []).length;
  const inMarkEdited = (editorSrc.match(/editRevisionRef\.current \+= 1; setDirty\(true\);/g) || []).length;
  assert.equal(bareDirtyTrue, conditionalDirtyTrue + inMarkEdited);
  // impure-updater tripwire: no save call inside any setRich(prev => …) updater
  for (const m of editorSrc.matchAll(/setRich\(\(prev\) => \{([\s\S]*?)\}\);/g)) {
    assert.ok(!m[1].includes('onSaveTemplates'), 'onSaveTemplates must not be called inside a setRich updater');
  }
  // deleteTemplates marks the delete as an edit before dispatching its save
  assert.match(editorSrc, /const next = rich\.filter\(\(t\) => !ids\.has\(t\.id\)\);\s*\n\s*markEdited\(\);/);
});

test('BL-23 tripwire: Cancel invalidates in-flight save/delete settlements (revision bump before reload)', () => {
  const cancel = editorSrc.slice(editorSrc.indexOf('const handleCancelEdits'));
  const block = cancel.slice(0, cancel.indexOf('};') + 2);
  assert.match(block, /editRevisionRef\.current \+= 1;/);
  assert.match(block, /reloadFromProps\(\);/);
});

test('BL-23 tripwire: Dashboard persistTemplates counts row failures and throws; outer catch rethrows', () => {
  assert.match(dashboardSrc, /let rowFailures = 0;/);
  // queued saves must diff against the freshest persisted rows, not the closure's render-time templates
  assert.match(dashboardSrc, /const baselineTemplates = \(supabaseRowsRef\.current \|\| \[\]\)\.map/);
  assert.match(dashboardSrc, /const currentTemplateIds = new Set\(baselineTemplates\.map/);
  assert.match(dashboardSrc, /for \(const template of baselineTemplates\)/);
  // the rows ref is render-synced AND advanced synchronously from the refetch result
  assert.match(dashboardSrc, /supabaseRowsRef\.current = supabaseTemplates;/);
  assert.match(dashboardSrc, /const freshRows = await refetchTemplates\(\);/);
  assert.match(dashboardSrc, /supabaseRowsRef\.current = freshRows;/);
  // resolver consults the fresh rows ref, not only render state
  assert.match(dashboardSrc, /\(supabaseRowsRef\.current \|\| supabaseTemplates \|\| \[\]\)\.find/);
  const increments = dashboardSrc.match(/rowFailures \+= 1;/g) || [];
  assert.equal(increments.length, 4); // delete, orphan-create, update, create
  assert.match(dashboardSrc, /if \(rowFailures > 0\) \{\s*\n\s*throw new Error/);
  assert.match(dashboardSrc, /console\.error\('Error persisting templates:', err\);\s*\n\s*throw err;/);
});

test('BL-23 tripwire: Dashboard hubSaveTemplates rethrows after notifying', () => {
  const hub = dashboardSrc.slice(dashboardSrc.indexOf('const hubSaveTemplates'));
  const block = hub.slice(0, hub.indexOf('};') + 2);
  // KAL-57: the save-failure notice moved from native alert() to the in-app toast.
  assert.match(block, /showToast\('Failed to save templates\.', 'error'\);/);
  assert.match(block, /throw e;/);
});
