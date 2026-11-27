import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

describe('Projects narrow desktop layout (#1801)', () => {
  it('moves .projects-desktop-layout grid columns to hub.css so narrow desktop windows can stack panes', () => {
    const jsx = fs.readFileSync(path.join(root, 'src/home/ProjectsFolderTree.jsx'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'src/home/hub.css'), 'utf8');

    assert.match(jsx, /<div className="projects-desktop-layout">/);
    assert.doesNotMatch(jsx, /className="projects-desktop-layout"[^>]*gridTemplateColumns/);

    assert.match(css, /\.projects-tab-body\s*\{\s*container-type:\s*inline-size;\s*\}/);
    assert.match(
      css,
      /@container\s*\(max-width:\s*620px\)\s*\{[\s\S]*?\.projects-desktop-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    );
    assert.match(css, /\.survey-hub\s+\.projects-desktop-search\s*\{/);
  });
});
