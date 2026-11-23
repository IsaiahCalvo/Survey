// Settings, General tab polish (KAL-652, batch 15).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../src/components/AccountSettings.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/AccountSettings.css', import.meta.url), 'utf8');
const states = readFileSync(new URL('../src/styles/states.css', import.meta.url), 'utf8');

test('profile shows plain rows, not boxes that look like fields', () => {
  assert.ok(!jsx.includes('account-field-display'), 'the grey look-alike field boxes are gone');
  assert.match(jsx, /<dl className="account-profile-list">/);
  assert.match(jsx, /account-section-head[\s\S]{0,400}Edit profile/, 'Edit profile sits in the heading line');
});

test('account actions are rows, Delete last', () => {
  const at = jsx.indexOf('id="account-actions-heading"');
  assert.ok(at > 0);
  const block = jsx.slice(at, at + 4000);
  const order = ['Download my data', "'Sign out'", 'Delete account'].map((w) => block.indexOf(w.replace(/'/g, '')));
  assert.ok(order.every((i) => i > 0), 'all three actions are in the Account section');
  assert.ok(order[0] < order[1] && order[1] < order[2], 'data, then sign out, then delete');
});

test('Settings buttons: no hover lift, press at once, red press stays red', () => {
  assert.ok(!/translateY\(-1px\)/.test(css), 'hover is a colour step, nothing moves');
  assert.ok(!/\.account-btn-(primary|secondary|danger) \{[^}]*transition: all/.test(css), 'no catch-all transition');
  assert.match(css, /\.account-btn-danger:not\(:disabled\):active \{\s*background: color-mix\(in srgb, var\(--danger\) 40%/);
  const greyPress = states.split('\n').filter((l) => l.startsWith(":where(button, [role='button'], [role='tab'], [role='option'])"));
  assert.ok(greyPress.length >= 2);
  for (const l of greyPress) assert.ok(l.includes(':not(.account-btn-danger)'), 'the grey press skips the red button');
});
