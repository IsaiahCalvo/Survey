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

test('the print notice wears the toast look, not gold on black', () => {
  const print = readFileSync(new URL('../src/components/BrowserPrintDocument.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(print, /#f6d77b|#5f5130/);
  assert.match(print, /\.survey-browser-print-progress \{[\s\S]*?background: var\(--surface-2\);[\s\S]*?color: var\(--text-1\);/);
});

test('Activity shows your avatar letters from your name, like the account button', () => {
  const act = readFileSync(new URL('../src/projectItems/ProjectActivityPanel.jsx', import.meta.url), 'utf8');
  assert.match(act, /const ownName = user\?\.name \|\| meta\.full_name \|\| \[meta\.first_name, meta\.last_name\]/);
  assert.match(act, /presenceInitials\(who === 'You' \? \(ownName \|\| 'You'\) : who\)/);
});
