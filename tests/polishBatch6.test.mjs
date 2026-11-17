import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../src/components/AccountSettings.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/AccountSettings.css', import.meta.url), 'utf8');

test('"Current plan" is a mark, not a disabled button the shared rule fades', () => {
  assert.doesNotMatch(jsx, /<button className="account-btn-outline-(green|blue|gold)" disabled>/);
  assert.match(jsx, /className="account-btn-outline-green account-plan-mark"/);
  assert.match(css, /\.account-plan-mark \{[^}]*user-select: none/);
});

test('the Manage plans section draws no rule under the plan cards', () => {
  assert.match(jsx, /subscriptionViewTab === 'manage' \? 'block' : 'none', borderBottom: 'none'/);
});
