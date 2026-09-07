import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Draw category uses supplied option 5 while Pen keeps its own icon', async () => {
  const [icon, icons, shell, viewer, mobile] = await Promise.all([
    read('../src/assets/icons/draw-group-option-5.svg'),
    read('../src/Icons.jsx'),
    read('../src/AppShell.jsx'),
    read('../src/PDFViewer.jsx'),
    read('../src/mobile/MobilePdfViewerChrome.jsx'),
  ]);

  assert.match(icon, /M736\.5 584\.9C729\.1 582\.91/);
  assert.match(icon, /M697\.5 581\.56C708\.32 587\.2/);
  assert.match(icon, /fill="currentColor"/);
  assert.doesNotMatch(icon, /M614\.27 849\.5|<image\b|data:image/i);
  assert.match(icons, /import drawGroupIconUrl from '\.\/assets\/icons\/draw-group-option-5\.svg';/);
  assert.match(icons, /drawGroup:.*renderMaskIcon\(drawGroupIconUrl,/);
  assert.match(shell, /aria-label="Draw"[\s\S]{0,500}<Icon name="drawGroup" size=\{18\}/);
  assert.match(viewer, /\{ id: 'pen', label: 'Pen', iconName: 'pen' \}/);
  // 2026-09-07 (A7): the phone's Draw GROUP button used to show the Pen tool's
  // own icon while desktop showed the calligraphic draw-group pen. Same tool,
  // same glyph on both.
  assert.match(mobile, /draw:\s*\{[\s\S]{0,120}icon: 'drawGroup',/);
  assert.match(mobile, /\{ id: 'pen', label: 'Pen', icon: 'pen' \}/);
});
