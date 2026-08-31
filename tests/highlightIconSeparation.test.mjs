import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('text highlight and the freehand highlighter use separate locked assets', async () => {
  const [iconsSource, textHighlight, highlighterTool] = await Promise.all([
    readFile(path.join(repoRoot, 'src/Icons.jsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/assets/icons/text-highlight.svg')),
    readFile(path.join(repoRoot, 'src/assets/icons/highlighter-tool.svg')),
  ]);

  assert.equal(createHash('sha256').update(textHighlight).digest('hex'), 'bfe4a937890f2bd90e59aa3eb8d2f9e3e0224bd77c9c7a2f3e75919f21e6e932');
  assert.equal(createHash('sha256').update(highlighterTool).digest('hex'), '201fe900b4659980ee3e2329ae4b5ff97a2df1721709869526dd7ef41050adfe');
  assert.equal(highlighterTool.toString('utf8').match(/stroke-width="7\.2"/g)?.length, 3);
  assert.match(iconsSource, /formatHighlight:\s*\(size, color, style, className\)\s*=>\s*renderMaskIcon\(textHighlightUrl,/);
  assert.match(iconsSource, /highlighterTool:\s*\(size, color, style, className\)\s*=>\s*renderMaskIcon\(highlighterToolUrl,/);
  assert.match(iconsSource, /highlighter:\s*'highlighterTool'/);
  assert.doesNotMatch(iconsSource, /highlighter:\s*'formatHighlight'/);
});

test('desktop and mobile drawing toolbars request the shared highlighter icon', async () => {
  const [desktopSource, mobileSource] = await Promise.all([
    readFile(path.join(repoRoot, 'src/PDFViewer.jsx'), 'utf8'),
    readFile(path.join(repoRoot, 'src/mobile/MobilePdfViewerChrome.jsx'), 'utf8'),
  ]);

  assert.match(desktopSource, /\{ id: 'highlighter', label: 'Highlighter', iconName: 'highlighter' \}/);
  assert.match(mobileSource, /\{ id: 'highlighter', label: 'Highlighter', icon: 'highlighter' \}/);
});
