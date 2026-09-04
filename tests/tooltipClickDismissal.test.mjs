import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const tooltipSource = await readFile(new URL('../src/components/Tooltip.jsx', import.meta.url), 'utf8');
const appShellSource = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const viewerSource = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('shared tooltips stay hidden after a press until the pointer leaves', () => {
  assert.match(tooltipSource, /const pressedControls = new WeakSet\(\)/);
  assert.match(tooltipSource, /if \(pressedControls\.has\(el\)\) return/);
  assert.match(tooltipSource, /onMouseDown: hideOnPress/);
  assert.match(tooltipSource, /onPointerDown: hideOnPress/);
  assert.match(tooltipSource, /onMouseLeave: resetAfterLeave/);
});

test('desktop tool buttons use the shared click-safe tooltip binding', () => {
  assert.match(appShellSource, /\.\.\.chromeTip\(label, 'below'\)/);
  assert.doesNotMatch(appShellSource, /bottomToolbarApi\.setTooltip\(\{\s*visible: true/);
  assert.doesNotMatch(viewerSource, /setTooltip\(\{\s*visible: true/);
  assert.match(viewerSource, /\.\.\.chromeTip\(t\.label, 'below'\)/);
});
