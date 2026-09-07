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
  // 2026-09-07 polish pass: the Text GROUP button now shows the owner's
  // text-box glyph too. It previously showed a serif "T" while the Text option
  // inside its own sub-toolbar showed the text-box icon, so the group button
  // and the tool it opens disagreed. The old assertion pinned that mismatch.
  assert.match(appShell, /aria-label="Text"[\s\S]{0,900}<Icon name="textBox" size=\{18\}/);
  assert.match(viewer, /\{ id: 'text', label: 'Text', iconName: 'textBox' \}/);
  assert.match(mobile, /review:\s*\{[\s\S]{0,180}icon: 'text',[\s\S]{0,180}\{ id: 'text', label: 'Text', icon: 'textBox' \}/);
  assert.match(formTools, /id: 'form-textbox'[\s\S]{0,100}iconName: 'textBox'/);
});
