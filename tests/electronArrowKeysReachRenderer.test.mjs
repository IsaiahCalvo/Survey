// w57 (2026-09-28) — the desktop app (Electron) must hand arrow keys to the
// page exactly as the browser does, so arrow-key nudge (useSVGInteraction /
// SVGAnnotationLayer, shared by web and desktop — no Electron-only branch)
// works there too. Arrows could only be swallowed on the main-process side:
// a menu accelerator, a globalShortcut, or before-input-event calling
// preventDefault. This pins that none of them touch the arrow keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('../src/electron-main.js');
const preload = read('../src/preload.js');

test('no menu accelerator or global shortcut claims an arrow key', () => {
  const accelerators = [...main.matchAll(/accelerator:\s*['"`]([^'"`]+)['"`]/g)].map((m) => m[1]);
  assert.ok(accelerators.length > 0, 'menu accelerators were found (the parser still works)');
  for (const accelerator of accelerators) {
    assert.doesNotMatch(accelerator, /\b(Up|Down|Left|Right)\b/i, accelerator);
  }
  assert.doesNotMatch(main, /globalShortcut/);
});

test('before-input-event blocks only the zoom and developer keys, never arrows', () => {
  const start = main.indexOf("win.webContents.on('before-input-event'");
  assert.ok(start >= 0);
  const handler = main.slice(start, main.indexOf('\n  });', start));
  assert.doesNotMatch(handler, /Arrow/);
  // every preventDefault in it sits behind a Cmd/Ctrl zoom chord or a
  // developer-key check
  assert.match(handler, /\(input\.control \|\| input\.meta\) && \(input\.key === '\+'/);
  assert.match(handler, /if \(isReload \|\| isInspect \|\| isMacInspect \|\| isF12\) \{\s*event\.preventDefault\(\);/);
});

test('the preload bridge adds no key listeners of its own', () => {
  assert.doesNotMatch(preload, /addEventListener\(\s*['"]key(down|up)['"]/);
});
