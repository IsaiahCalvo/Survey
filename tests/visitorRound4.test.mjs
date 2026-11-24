// Round 4 audit, first run and no account (survey-audit/round4/first-run-no-account.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');

test('r4d #3: New project with no account says it needs one before the form opens', () => {
  const dash = read('../src/Dashboard.jsx');
  const body = dash.slice(dash.indexOf('const handleCreateProjectClick = () => {'), dash.indexOf('setIsProjectModalOpen(true);', dash.indexOf('const handleCreateProjectClick = () => {')));
  assert.match(body, /if \(!user\) \{\s*showToast\('Projects need a free account\.[^']*', 'info', \{[\s\S]{0,120}label: 'Sign in'[\s\S]{0,80}return;\s*\}/);
});

test('r4d #1: the upload cards sit at the screen root, so they take clicks over an open document', () => {
  for (const file of ['UploadReviewModal.jsx', 'UploadCheckModal.jsx', 'DuplicateUploadModal.jsx']) {
    const src = read(`../src/components/${file}`);
    assert.match(src, /<DialogCard[\s\S]{0,600}\n\s*atRoot\n/, `${file} mounts at the root`);
  }
});
