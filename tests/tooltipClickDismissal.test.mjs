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
  assert.match(tooltipSource, /e\?\.type === 'focus' && !el\.matches\?\.\(':focus-visible'\)/);
});

test('choosing a select mode cannot leave a tooltip stranded', () => {
  // DELIBERATE ASSERTION CHANGE (2026-09-21, pass 7 — owner-approved board 14):
  // choosing a select mode no longer closes a popover and hands focus back to a
  // split button, because there is no popover and no split button. The three
  // modes are a segmented toggle sitting in the bar, so each segment is an
  // ordinary chrome control and the shared click-safe tooltip binding (asserted
  // in the next test) is the whole mechanism. The defect this test was written
  // for — a tooltip left painted over the page after the menu closed — cannot
  // happen without a menu, and the toggle must carry that shared binding.
  assert.match(appShellSource, /data-select-mode-toggle="true"/);
  assert.match(appShellSource, /\{\.\.\.chromeTip\(opt\.label, 'below'\)\}/);
  assert.doesNotMatch(appShellSource, /desktop-select-mode-menu/);
});

test('desktop tool buttons use the shared click-safe tooltip binding', () => {
  assert.match(appShellSource, /\.\.\.chromeTip\(label, 'below'\)/);
  assert.doesNotMatch(appShellSource, /bottomToolbarApi\.setTooltip\(\{\s*visible: true/);
  assert.doesNotMatch(viewerSource, /setTooltip\(\{\s*visible: true/);
  assert.match(viewerSource, /\.\.\.chromeTip\(t\.label, 'below'\)/);
});
