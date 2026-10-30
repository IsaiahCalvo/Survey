// Design review 2026-10-27: the browser's own confirm() / prompt() boxes (a
// white system dialog over the dark app) were left in the Excel import and
// the revision label. They use the themed dialogs (components/dialogPrompts.jsx)
// now, and none may come back.
//
// The one left is PageAnnotationLayer's note prompt: the Note tool it belongs
// to is switched off (PDFViewer's tool list has it commented out), so that
// path never runs. Move it to askPrompt if the tool comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ALLOWED = { 'src/PageAnnotationLayer.jsx': 1 };

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (name !== '__tests__') walk(path, out); }
    else if (/\.(jsx?|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

test('no browser confirm() or prompt() boxes in the app', () => {
  const over = [];
  for (const file of walk(join(root, 'src'))) {
    const rel = relative(root, file).split('\\').join('/');
    const code = readFileSync(file, 'utf8').split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
    const hits = (code.match(/(?<![\w.])(window\.)?(confirm|prompt)\((?!\))/g) || []).length;
    if (hits > (ALLOWED[rel] || 0)) over.push(`${rel}: ${hits}`);
  }
  assert.deepEqual(over, []);
});
