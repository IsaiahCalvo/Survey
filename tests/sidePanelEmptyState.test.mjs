// Design review 2026-10-27: an empty side panel says so the same way in
// Search, Bookmarks and History: one centred quiet line, 32px down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Search, Bookmarks and History centre their empty line 32px down', () => {
  const search = read('src/sidebar/searchTextPanel.css').match(/\.search-text-panel__empty \{([^}]*)\}/)[1];
  assert.match(search, /padding: 32px 20px;/);
  assert.match(search, /text-align: center;/);

  const bookmarks = read('src/sidebar/BookmarksPanel.jsx');
  assert.match(bookmarks, /textAlign: 'center',\s*padding: '32px 20px',[\s\S]{0,200}\n\s*No bookmarks yet\. Create one to get started\./);

  const history = read('src/components/revisions/RevisionsPanel.jsx').match(/\.dh-empty \{([^}]*)\}/)[1];
  assert.match(history, /padding: 32px var\(--dh-edge\);/);
  assert.match(history, /text-align: center;/);
});

test('Annotations, with nothing drawn, shows only the empty line, 32px down', () => {
  const jsx = read('src/sidebar/MarkupsPanel.jsx');
  const head = jsx.indexOf('<div className="markups-panel__head">');
  assert.ok(head > 0);
  assert.match(jsx.slice(head - 300, head), /\{rows\.length > 0 && \(\s*$/);
  assert.match(jsx, /\{filtered && rows\.length > 0 && \(/);
  const css = read('src/sidebar/MarkupsPanel.css').match(/\.markups-panel__summary\.is-empty \{([^}]*)\}/)[1];
  assert.match(css, /padding: 32px 20px;/);
  assert.match(css, /text-align: center;/);
});
