// Nightly 'ctrl-lasso' (Drawboard PDF Pro, 2026-11-14): Ctrl / Cmd + mouse
// drag under Box Select draws a lasso for that drag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isCtrlLassoPress } from '../src/utils/lassoSelection.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('Ctrl or Cmd with a left mouse press, only with the flag on', () => {
  assert.equal(isCtrlLassoPress({ ctrlKey: true, pointerType: 'mouse', button: 0 }, true), true);
  assert.equal(isCtrlLassoPress({ metaKey: true, pointerType: 'mouse', button: 0 }, true), true);
  assert.equal(isCtrlLassoPress({ ctrlKey: true, pointerType: 'mouse', button: 0 }, false), false);
  assert.equal(isCtrlLassoPress({ pointerType: 'mouse', button: 0 }, true), false);
  assert.equal(isCtrlLassoPress({ ctrlKey: true, altKey: true, pointerType: 'mouse' }, true), false);
  assert.equal(isCtrlLassoPress({ ctrlKey: true, pointerType: 'touch' }, true), false);
  assert.equal(isCtrlLassoPress({ ctrlKey: true, pointerType: 'pen' }, true), false);
  assert.equal(isCtrlLassoPress({ ctrlKey: true, pointerType: 'mouse', button: 2 }, true), false);
  assert.equal(isCtrlLassoPress(null, true), false);
});

test('flag, migration and the bare-page lasso branch', () => {
  assert.equal(FEATURE_FLAGS['ctrl-lasso'].stage, 'beta');
  const hook = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
  assert.match(hook, /const \[ctrlLassoOn\] = useState\(\(\) => isFeatureOn\('ctrl-lasso'\)\);/);
  assert.match(hook, /const ctrlLasso = selectionMode !== 'lasso' && isCtrlLassoPress\(e, ctrlLassoOn\);\s*if \(e\.target === svgRef\.current && activeTool === 'select' && \(selectionMode === 'lasso' \|\| ctrlLasso\)\) \{/);
  const migration = readFileSync(new URL('../supabase/migrations/20261114160000_ctrl_lasso_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'ctrl-lasso', 'off'/);
});
