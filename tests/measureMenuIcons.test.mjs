// Wall area and Volume have their own icons in the Measure menu (desktop and
// phone), so the pairs no longer look alike (phone check, 2026-11-10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('each measure kind has its own icon', () => {
  const icons = read('src/Icons.jsx');
  for (const name of ['measureWallArea', 'measureVolume']) assert.match(icons, new RegExp(`\\n    ${name}: \\(size`), name);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /\{ key: 'wallArea', label: 'Wall area', iconName: 'measureWallArea' \}/);
  assert.match(viewer, /\{ key: 'volume', label: 'Volume', iconName: 'measureVolume' \}/);
  const rail = read('src/mobile/mobileShapeRail.js');
  assert.match(rail, /key: 'wallArea', label: 'Wall area', icon: 'measureWallArea'/);
  assert.match(rail, /key: 'volume', label: 'Volume', icon: 'measureVolume'/);
});
