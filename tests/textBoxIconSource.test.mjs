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
  // DELIBERATE ASSERTION CHANGE (2026-09-21, pass 7): a chrome tool glyph is
  // CHROME_GLYPH (16 in a 28px button) rather than the literal 18.
  assert.match(appShell, /aria-label="Text"[\s\S]{0,500}<Icon name="textGroup" size=\{CHROME_GLYPH\}/);
  assert.match(viewer, /\{ id: 'text', label: 'Text', iconName: 'textBox' \}/);
  assert.match(mobile, /review:\s*\{[\s\S]{0,180}icon: 'textGroup',[\s\S]{0,180}\{ id: 'text', label: 'Text', icon: 'textBox' \}/);
  assert.match(formTools, /id: 'form-textbox'[\s\S]{0,100}iconName: 'textBox'/);
});

test('Text group uses the exact Lucide scan-text icon on desktop and mobile', async () => {
  const [iconsSource, appShell, mobile] = await Promise.all([
    readFile(new URL('../src/Icons.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8'),
  ]);

  // DELIBERATE ASSERTION CHANGE (2026-09-21, pass 7 — owner ruling, repeated in
  // the pass-7 brief: "Text tool icon = lucide scan-text, EVERYWHERE in the app
  // (rail, desktop bar, menus)"). The group's glyph was the Lucide Case
  // Sensitive "Aa", which reads as a FONT control; the group draws a text box and
  // a callout, which is what scan-text shows. The asset file stays on disk
  // unused. What this test is named for — that the glyph is EXACTLY Lucide's
  // geometry at the house 1.5 weight, and that desktop and phone render the same
  // one — is asserted below against the new glyph.
  assert.match(iconsSource, /scanText: \(size, color, style, className\) => \(/);
  assert.match(iconsSource, /<path d="M3 7V5a2 2 0 0 1 2-2h2" \/>/);
  assert.match(iconsSource, /<path d="M7 16h6" \/>/);
  assert.match(iconsSource, /<g stroke=\{color\} strokeWidth="1\.5"/);
  assert.match(iconsSource, /textGroup: 'scanText',/);
  assert.doesNotMatch(iconsSource, /case-sensitive\.svg/);
  assert.match(appShell, /aria-label="Text"[\s\S]{0,500}<Icon name="textGroup" size=\{CHROME_GLYPH\}/);
  assert.match(mobile, /review:\s*\{[\s\S]{0,180}icon: 'textGroup'/);
});
