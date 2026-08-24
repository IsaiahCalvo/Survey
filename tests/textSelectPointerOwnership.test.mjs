import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

test('Text Select does not install the existing-mark pointer capture handler', () => {
  const effectStart = source.indexOf("document.addEventListener('pointerdown', handlePointerDownCapture, true)");
  assert.notEqual(effectStart, -1);
  const effectGuard = source.slice(Math.max(0, effectStart - 500), effectStart);
  assert.match(effectGuard, /activeTool !== 'select'\) return undefined/);
  assert.doesNotMatch(effectGuard, /activeTool !== 'select' && activeTool !== 'text-select'/);
  const callbackGuards = [...source.matchAll(/const handleSelectPdfjsTextMarkup(?:FromClientPoint)? = useCallback\([^]*?if \(([^\n]+)\) return false;/g)]
    .map((match) => match[1]);
  assert.equal(callbackGuards.length, 2);
  assert.deepEqual(callbackGuards, ["activeTool !== 'select'", "activeTool !== 'select'"]);
});
