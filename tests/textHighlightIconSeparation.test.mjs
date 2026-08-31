import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('Text Highlight uses the approved cutout-T asset, not the freehand Highlighter icon', async () => {
  const [iconsSource, viewerSource, textHighlight] = await Promise.all([
    readFile(path.join(repoRoot, 'src/Icons.jsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/PDFViewer.jsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/assets/icons/text-highlight.svg')),
  ]);

  assert.equal(createHash('sha256').update(textHighlight).digest('hex'), 'bfe4a937890f2bd90e59aa3eb8d2f9e3e0224bd77c9c7a2f3e75919f21e6e932');
  assert.match(iconsSource, /formatHighlight:\s*\(size, color, style, className\)\s*=>\s*renderMaskIcon\(textHighlightUrl,/);
  assert.match(viewerSource, /<Icon name="formatHighlight" size=\{18\} \/>[\s\S]{0,40}Text highlight/);
  assert.doesNotMatch(iconsSource, /formatHighlight:\s*[^\n]*highlighter/);
});
