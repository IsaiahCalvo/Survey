import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const desktopWorkflow = readFileSync(
  new URL('../agent-cli/mobile-workflows/survey-template-desktop.mjs', import.meta.url),
  'utf8',
);

test('desktop survey-template reload waits for exact storage and hydrated DOM', () => {
  assert.match(desktopWorkflow, /async function waitForReloadedTemplate/);
  assert.match(desktopWorkflow, /stored\?\.name !== templateName/);
  assert.match(desktopWorkflow, /stored\.modules\?\.some\(\(entry\) => entry\.id === moduleId\)/);
  assert.match(desktopWorkflow, /input\[title="Click to rename"\]/);
  assert.match(desktopWorkflow, /element\.dataset\.moduleTabId === moduleId/);
  assert.match(desktopWorkflow, /await waitForReloadedTemplate\(page, ids\)/);
  assert.match(desktopWorkflow, /count\(\) === 1,[\s\S]{0,100}'Desktop template rename missing after reload'/);
  assert.match(desktopWorkflow, /count\(\) === 1,[\s\S]{0,100}'Desktop module missing after reload'/);
});
