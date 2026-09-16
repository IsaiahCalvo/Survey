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
  // DELIBERATE ASSERTION CHANGE (2026-09-16, desktop sweep): the highlighter
  // asset's sha256 and its stroke-width literal were both re-taken. Its stroke
  // was 7.2 on its 128-unit viewBox = 1.35 on the house 24 grid, so it painted
  // 10% lighter than every icon beside it in the draw sub-toolbar. It is now 8 =
  // exactly the house 1.5. Owner ruling of this pass: ONE stroke weight across
  // the set, and a sha256 pin is not a reason to stay off it — the pin exists to
  // stop the asset drifting silently, and this change is neither silent nor
  // drift. What this test is FOR — text highlight and the freehand highlighter
  // being two separate locked assets, wired to separate renderers — is untouched,
  // and the three-stroke count still guards the glyph's shape.
  assert.equal(createHash('sha256').update(highlighterTool).digest('hex'), '7a167ae7d73bf7c288286468777f679c80a6e48c28fe685b7f1078f9ab6dbb50');
  assert.equal(highlighterTool.toString('utf8').match(/stroke-width="8"/g)?.length, 3);
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
