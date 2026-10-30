// Owner 2026-10-27: "You got the dropdown with a white border around it. That
// should never happen anywhere." The launch audit (2026-10-30) found the
// toolbar drop-downs, the width card, the Spaces cards and the phone menus
// drawn with --border-strong while the home menus, toasts and dialogs used
// --border, so some pop-ups had a light outline and some did not.
//
// The rule (tokens.css): a pop-up card — anything that wears the one pop-up
// shadow, --shadow-popover — takes the subtle --border edge. --border-strong
// is only for an edge that is the one thing showing a control is there
// (inputs, outlined buttons, checkboxes, focus rings).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function cssFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) cssFiles(path, out);
    else if (name.endsWith('.css')) out.push(path);
  }
  return out;
}

test('no pop-up card draws the strong edge', () => {
  const offenders = [];
  for (const path of cssFiles(join(root, 'src'))) {
    const css = readFileSync(path, 'utf8');
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (selector.includes(':root')) continue;
      if (/box-shadow:[^;]*--shadow-popover/.test(body) && /border(-[a-z]+)?:[^;]*--border-strong/.test(body)) {
        offenders.push(`${relative(root, path)} ${selector.trim().split('\n').pop()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'pop-up cards take border: 1px solid var(--border)');
});
