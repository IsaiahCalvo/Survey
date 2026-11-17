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
  // The header wraps at any width now (KAL-652: with the Nightly suite
  // buttons a 1440 desktop cut the name to "K..." too); narrow panes still
  // line the dropped row up past the gold bar.
  assert.match(css, /\.projects-open-head \{ flex-wrap: wrap; row-gap: 10px; \}/);
  assert.match(css, /\.projects-open-head > :has\(> \.hub-title-field\) \{ flex: 1 1 240px !important; \}/);
  assert.match(css, /\.projects-open-actions \{[^}]*width: calc\(100% - 18px\)/);
});
