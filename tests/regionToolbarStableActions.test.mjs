// The region tool publishes its toolbar API into PDFViewer state from an
// effect. Handler identities in that effect's deps looped with the viewer's
// re-render ("Maximum update depth exceeded" on the phone region e2e).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStableActions } from '../src/utils/stableActionProxy.js';

test('stable actions keep their identity and call the latest handler', () => {
  const ref = { current: { confirm: () => 'first' } };
  const actions = createStableActions(ref, ['confirm', 'cancel']);
  const confirm = actions.confirm;
  assert.equal(confirm(), 'first');
  ref.current = { confirm: (x) => `second:${x}` };
  assert.equal(actions.confirm, confirm);
  assert.equal(actions.confirm(1), 'second:1');
  assert.equal(actions.cancel(), undefined);
});

test('the region toolbar publish effect depends on data, not handler identities', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/RegionSelectionTool.jsx'), 'utf8');
  const start = src.indexOf('onMobileToolbarApiChange({\n      toolType');
  assert.ok(start > 0);
  const deps = src.slice(src.indexOf('}, [', start), src.indexOf(']);', start));
  for (const handler of ['handleConfirm', 'handleCancel', 'handleDeleteSelected', 'handleSetFullPage', 'chooseToolType', 'applyFullPage', 'selectedRegionIds,']) {
    assert.ok(!deps.includes(handler), `${handler} must not be a publish dependency`);
  }
  assert.match(deps, /regionToolbarActions/);
});
