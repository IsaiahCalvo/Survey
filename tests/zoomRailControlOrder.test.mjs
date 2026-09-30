import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appShell = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');

test('collapsed zoom rail shows zoom in above the level and zoom out below it', () => {
  const collapsedStart = appShell.indexOf('if (!railPanelEl)');
  const collapsedEnd = appShell.indexOf('// Expanded 320px survey panel', collapsedStart);

  assert.ok(collapsedStart >= 0 && collapsedEnd > collapsedStart, 'collapsed zoom rail exists');

  const collapsedRail = appShell.slice(collapsedStart, collapsedEnd);
  const zoomIn = collapsedRail.indexOf('aria-label="Zoom in"');
  const zoomLevel = collapsedRail.indexOf('{zoomValue}');
  const zoomOut = collapsedRail.indexOf('aria-label="Zoom out"');

  assert.ok(zoomIn >= 0 && zoomLevel >= 0 && zoomOut >= 0, 'all zoom controls exist');
  assert.ok(zoomIn < zoomLevel, 'zoom in is above the percentage');
  assert.ok(zoomLevel < zoomOut, 'zoom out is below the percentage');
  assert.match(collapsedRail, /onClick=\{api\.zoomIn\}[\s\S]*?<Icon name="plus"/);
  assert.match(collapsedRail, /onClick=\{api\.zoomOut\}[\s\S]*?<Icon name="minus"/);
});
