import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// 2026-09-08: the Draw group glyph was changed from the supplied "option 5"
// calligraphic pen asset (src/assets/icons/draw-group-option-5.svg, now deleted)
// to Lucide's "square-pen" drawn inline in Icons.jsx. The assertions that pinned
// the old asset's path data and its renderMaskIcon wiring are therefore
// obsolete and are replaced below with the equivalent checks on the new inline
// artwork. Everything the original test actually guarded is kept: the Draw
// GROUP button must NOT reuse the Pen sub-tool's glyph, and desktop and phone
// must show the same group glyph.
test('Draw category uses the square-pen group glyph while Pen keeps its own icon', async () => {
  const [icons, shell, viewer, mobile] = await Promise.all([
    read('../src/Icons.jsx'),
    read('../src/AppShell.jsx'),
    read('../src/PDFViewer.jsx'),
    read('../src/mobile/MobilePdfViewerChrome.jsx'),
  ]);

  // The group glyph is inline (24x24, unfilled, currentColor stroke) so the
  // toolbar's active/hover colours drive it, and it no longer imports an asset.
  assert.match(icons, /drawGroup: \(size, color, style, className\) => \(\s*\n\s*<svg[^>]*viewBox="0 0 24 24"[^>]*fill="none"/);
  assert.match(icons, /M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7/);
  assert.match(icons, /M18\.375 2\.625a1 1 0 0 1 3 3l-9\.013 9\.014a2 2 0 0 1-\.853\.505l-2\.873\.84a\.5\.5 0 0 1-\.62-\.62l\.84-2\.873a2 2 0 0 1 \.506-\.852z/);
  assert.doesNotMatch(icons, /draw-group-option-5\.svg/);

  assert.match(shell, /aria-label="Draw"[\s\S]{0,500}<Icon name="drawGroup" size=\{18\}/);
  assert.match(viewer, /\{ id: 'pen', label: 'Pen', iconName: 'pen' \}/);
  // 2026-09-07 (A7): the phone's Draw GROUP button used to show the Pen tool's
  // own icon while desktop showed the group glyph. Same tool, same glyph on both.
  assert.match(mobile, /draw:\s*\{[\s\S]{0,120}icon: 'drawGroup',/);
  assert.match(mobile, /\{ id: 'pen', label: 'Pen', icon: 'pen' \}/);
});
