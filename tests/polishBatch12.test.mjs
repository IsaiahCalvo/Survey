import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('one look: a setting pill rests on raised, hovers to raised-2 and presses to pressed-2', () => {
  const css = read('src/styles.css');
  assert.match(css, /html\[data-look='suite'\] \.chrome-pill \{ background: var\(--hover\); \}/);
  assert.match(css, /html\[data-look='suite'\] \.chrome-pill:not\(:disabled\):hover \{ background: var\(--surface-3\); \}/);
  assert.match(css, /\.chrome-pill:not\(:disabled\):active \{\n\s*background-color: var\(--pressed-2, var\(--pressed\)\) !important;/);
  const states = read('src/styles/states.css');
  // The app-wide hover and press rules leave the pill to its own steps.
  assert.match(states, /\.survey-hub button:not\(:disabled\):not\(\[aria-disabled='true'\]\):not\(\[aria-pressed='true'\]\):not\(\.hub-title-switch\):not\(\.chrome-pill\)/);
  assert.equal((states.match(/:not\(\.mobile-survey-notes-save\):not\(\.chrome-pill\) \{\n\s*background-color: var\(--pressed/g) || []).length, 2);
});

test('one look: a pill on the ground colour (template checklist rows) rests on the panel colour', () => {
  const css = read('src/home/TemplatesEditor.css');
  assert.match(css, /html\[data-look='suite'\] \.ed-scope \.swipe-row \.chrome-pill \{ background: var\(--surface-2\); \}/);
  assert.match(css, /html\[data-look='suite'\] \.ed-scope \.swipe-row \.chrome-pill:not\(:disabled\):hover \{ background: var\(--hover\); \}/);
});
