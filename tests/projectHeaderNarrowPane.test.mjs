import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/home/hub.css', import.meta.url), 'utf8');
const tree = readFileSync(new URL('../src/home/ProjectsFolderTree.jsx', import.meta.url), 'utf8');

// iPad portrait: the open-project pane is ~230px wide. Add files and Manage
// team must drop under the name instead of cutting it to "E2E Sa...".
test('narrow project pane: header buttons wrap under the project name', () => {
  assert.match(tree, /className="projects-open-head"/);
  assert.match(tree, /className="projects-open-actions"/);
  assert.match(css, /@container \(max-width: 480px\) \{\s*\.projects-open-head \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.projects-open-actions \{[^}]*width: calc\(100% - 18px\)/);
});
