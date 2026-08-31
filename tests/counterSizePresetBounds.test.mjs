import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const appShellSource = read('../src/AppShell.jsx');
const viewerSource = read('../src/PDFViewer.jsx');
const mobileSource = read('../src/mobile/MobilePdfViewerChrome.jsx');

test('every counter size control accepts presets through 76 without widening other tools', () => {
  assert.match(
    appShellSource,
    /contextTool === 'counter'\s*\? COUNTER_SIZE_MAX\s*:\s*50/,
  );
  assert.match(
    mobileSource,
    /label="Size"[\s\S]{0,180}value=\{api\.eraserSizeInputValue\}[\s\S]{0,80}max=\{100\}/,
  );
  assert.match(
    mobileSource,
    /max=\{tool === 'counter' \? COUNTER_SIZE_MAX : 50\}/,
  );
  const counterAwareMaxes = viewerSource.match(
    /const maxWidth = isCounterSize \? COUNTER_SIZE_MAX : 50;/g,
  ) || [];
  assert.equal(counterAwareMaxes.length, 2);
  assert.match(
    viewerSource,
    /activeTool === 'counter'[\s\S]*?COUNTER_SIZE_MIN[\s\S]*?COUNTER_SIZE_MAX/,
  );
});
