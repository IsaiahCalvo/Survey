// Nightly 'ctrl-lasso' (Drawboard PDF Pro, 2026-11-14): Ctrl / Cmd + mouse
// drag under Box Select draws a lasso for that drag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isCtrlLassoPress } from '../src/utils/lassoSelection.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('the copy-drag key with a left mouse press, only with the flag on', () => {
  const win = false; const mac = true;
  assert.equal(isCtrlLassoPress({ ctrlKey: true, pointerType: 'mouse', button: 0 }, true, win), true);
  assert.equal(isCtrlLassoPress({ metaKey: true, pointerType: 'mouse', button: 0 }, true, mac), true);
  // Control+click is the right-click menu on a Mac; AltGr is not Ctrl.
  assert.equal(isCtrlLassoPress({ ctrlKey: true, pointerType: 'mouse', button: 0 }, true, mac), false);
  assert.equal(isCtrlLassoPress({ ctrlKey: true, altKey: true, pointerType: 'mouse' }, true, win), false);
  assert.equal(isCtrlLassoPress({ ctrlKey: true, pointerType: 'mouse', button: 0 }, false, win), false);
  assert.equal(isCtrlLassoPress({ pointerType: 'mouse', button: 0 }, true, win), false);
  assert.equal(isCtrlLassoPress({ ctrlKey: true, pointerType: 'touch' }, true, win), false);
  assert.equal(isCtrlLassoPress({ ctrlKey: true, pointerType: 'pen' }, true, win), false);
  assert.equal(isCtrlLassoPress({ ctrlKey: true, pointerType: 'mouse', button: 2 }, true, win), false);
  assert.equal(isCtrlLassoPress(null, true, win), false);
});

test('flag, migration and the bare-page lasso branch', () => {
  assert.equal(FEATURE_FLAGS['ctrl-lasso'].stage, 'rollout');
  const hook = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  assert.match(hook, /const \[ctrlLassoOn\] = useState\(\(\) => isFeatureOn\('ctrl-lasso'\)\);/);
  // Ctrl under Pan (copy-drag.spec) takes the same branch: boxesUnderPan.
  assert.match(hook, /const ctrlLasso = selectionMode !== 'lasso' && isCtrlLassoPress\(e, ctrlLassoOn\);[\s\S]{0,400}?if \(e\.target === svgRef\.current && \(activeTool === 'select' \|\| boxesUnderPan\) && \(selectionMode === 'lasso' \|\| ctrlLasso\)\) \{/);
  const migration = readFileSync(new URL('../supabase/migrations/20261114160000_ctrl_lasso_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'ctrl-lasso', 'off'/);
});
