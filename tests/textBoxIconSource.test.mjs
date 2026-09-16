import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Text tool uses the supplied text-box selection icon', async () => {
  const [iconSource, iconsSource, appShell, viewer, mobile, formTools] = await Promise.all([
    readFile(new URL('../src/assets/icons/text-box-selection.svg', import.meta.url), 'utf8'),
    readFile(new URL('../src/Icons.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/formDesignerTools.js', import.meta.url), 'utf8'),
  ]);

  assert.equal(
    createHash('sha256').update(iconSource.replace(/\r/g, '').trimEnd()).digest('hex'),
    '93dc4fe82256d28641f60b0bf4100b1c0c193768fb0bdf22a5c2f4d562dc838d',
  );
  assert.match(iconsSource, /import textBoxIconUrl from '\.\/assets\/icons\/text-box-selection\.svg';/);
  assert.match(iconsSource, /textBox:.*renderMaskIcon\(textBoxIconUrl,/);
  assert.match(iconsSource, /text: \(size, color, style, className\) => \([\s\S]*?points="4 7 4 4 20 4 20 7"/);
  assert.match(appShell, /aria-label="Text"[\s\S]{0,500}<Icon name="textGroup" size=\{18\}/);
  assert.match(viewer, /\{ id: 'text', label: 'Text', iconName: 'textBox' \}/);
  assert.match(mobile, /review:\s*\{[\s\S]{0,180}icon: 'textGroup',[\s\S]{0,180}\{ id: 'text', label: 'Text', icon: 'textBox' \}/);
  assert.match(formTools, /id: 'form-textbox'[\s\S]{0,100}iconName: 'textBox'/);
});

test('Text group uses the exact Lucide Case Sensitive icon on desktop and mobile', async () => {
  const [iconSource, iconsSource, appShell, mobile] = await Promise.all([
    readFile(new URL('../src/assets/icons/case-sensitive.svg', import.meta.url), 'utf8'),
    readFile(new URL('../src/Icons.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(iconSource, /<path d="m2 16 4\.039-9\.69a\.5\.5 0 0 1 \.923 0L11 16" \/>/);
  assert.match(iconSource, /<circle cx="18\.5" cy="12\.5" r="3\.5" \/>/);
  // DELIBERATE ASSERTION CHANGE (2026-09-16, icon-set consistency pass): the
  // Lucide geometry above is still exactly Lucide's, but the weight is the house
  // 1.5 rather than Lucide's own 2. At 2 this glyph painted 1.58px beside Pan's
  // 1.19px in the same rail column. Owner ruling of this pass: one stroke weight
  // across the set. The glyph's identity — which is what this test is named for —
  // is asserted by the two path/circle matches above and is untouched.
  // The dot is escaped: unescaped, /stroke-width="1.5"/ matched any character
  // there, so "1x5" or a future "1.75" would have passed a test whose whole point
  // is the weight.
  assert.match(iconSource, /stroke-width="1\.5"/);
  assert.match(iconsSource, /import textGroupIconUrl from '\.\/assets\/icons\/case-sensitive\.svg';/);
  assert.match(iconsSource, /textGroup:.*renderMaskIcon\(textGroupIconUrl,/);
  assert.match(appShell, /aria-label="Text"[\s\S]{0,500}<Icon name="textGroup" size=\{18\}/);
  assert.match(mobile, /review:\s*\{[\s\S]{0,180}icon: 'textGroup'/);
});
