// The Free-plan project limit: a calm toast with See plans (KAL-652, batch 17).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('See plans opens Settings on Subscription', () => {
  const dash = read('../src/Dashboard.jsx');
  assert.match(dash, /new CustomEvent\(OPEN_SETTINGS_EVENT, \{ detail: \{ tab: 'subscription' \} \}\)/);
  assert.match(dash, /isPurchaseUiHidden\(\) \? \{\} :/, 'no plans link where purchases are hidden');
  const hub = read('../src/home/SurveyHub.jsx');
  assert.match(hub, /window\.addEventListener\(OPEN_SETTINGS_EVENT, onOpen\)/);
  assert.match(hub, /setSettingsTab\(event\?\.detail\?\.tab \|\| null\)/);
  const settings = read('../src/components/AccountSettings.jsx');
  assert.match(settings, /initialTab === 'subscription' \? 'subscription' : 'general'/);
});

test('the error card uses the shared alert edge, not a one-off red', () => {
  const dash = read('../src/Dashboard.jsx');
  assert.ok(!dash.includes('rgba(249, 115, 115, 0.65)'));
  assert.match(dash, /border: 'var\(--alert-danger-border\)'/);
});
