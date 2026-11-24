// KAL-652 batch 22: an empty project cover offers one plain button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../src/projectAccess/ProjectSettings.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/projectAccess/projectAccess.css', import.meta.url), 'utf8');

test('an empty cover shows "Add cover picture" for an editor, and the words alone for a viewer', () => {
  assert.match(jsx, /\{!hasCover && canEdit && \(\s*<button type="button" className="hub-btn project-settings-cover-add" data-project-cover-pick/);
  assert.match(jsx, /<Icon name="image" size=\{14\} \/>Add cover picture/);
  assert.match(jsx, /\{!hasCover && !canEdit && <span className="project-settings-cover-empty">/);
});

test('the corner pencil and bin show only over a cover, and hover to the ground grey', () => {
  assert.match(jsx, /\{canEdit && hasCover && \(\s*<div className="project-settings-cover-actions">/);
  assert.equal(jsx.match(/data-project-cover-pick/g).length, 2, 'one pick button in each state');
  assert.match(css, /\.project-settings-cover-btn:hover \{ background: var\(--hover-ground, var\(--hover\)\); \}/);
});
