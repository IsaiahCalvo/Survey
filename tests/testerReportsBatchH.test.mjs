import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('#1664: typing outside a field goes into the open comment composer, not a tool shortcut', () => {
  const src = read('src/components/pins/PagePinsHost.jsx');
  assert.match(src, /focus: \(\) => areaRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(src, /if \(isTypingTarget\(document\.activeElement\)\) return;\s*if \(!boxRef\.current\?\.focus\) return;\s*boxRef\.current\.focus\(\);\s*event\.stopImmediatePropagation\(\);/);
  assert.match(src, /window\.addEventListener\('keydown', onKeyDown, true\);/);
});

test('#1664: the in-page text box takes a finger and stray typing', () => {
  const src = read('src/components/TextEditOverlay.jsx');
  assert.match(src, /data-pan-interactive="true"/);
  assert.match(src, /if \(e\.pointerType === 'mouse' \|\| e\.target === editableRef\.current\) return;/);
  assert.match(src, /if \(committedRef\.current \|\| event\.defaultPrevented\) return;[\s\S]*field\.focus\(\{ preventScroll: true \}\);\s*event\.stopImmediatePropagation\(\);/);
  assert.match(src, /import \{ isTypingTarget \} from '\.\.\/utils\/typingTarget\.js';/);
});
