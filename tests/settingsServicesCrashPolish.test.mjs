// KAL-652 batch 23: Connected services and Crash reports in Settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settings = readFileSync(new URL('../src/components/AccountSettings.jsx', import.meta.url), 'utf8');
const crash = readFileSync(new URL('../src/components/CrashReportsPanel.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/AccountSettings.css', import.meta.url), 'utf8');

test('Connect is a grey button; only Reconnect keeps the coral, with no one-off warning fill', () => {
  assert.match(settings, /className=\{msNeedsReconnect \? "account-btn-primary" : "account-btn-secondary"\}/);
  assert.doesNotMatch(settings, /backgroundColor: 'var\(--warning\)'/);
  const google = settings.slice(settings.indexOf('Connect to sign in with Google too.'));
  assert.match(google.slice(0, 1200), /className="account-btn-secondary"/);
});

test('connected services speak plainly', () => {
  assert.match(settings, /Not connected\. Connect to sync exports to OneDrive\./);
  assert.match(settings, /Your sign-in ran out\. Reconnect to keep syncing\./);
  assert.doesNotMatch(settings, /alternative login method/);
});

test('Copy and Clear show only when there are crash reports; the status line stays mounted', () => {
  assert.match(crash, /\{records\.length > 0 && \(\s*<>/);
  assert.doesNotMatch(crash, /disabled=\{records\.length === 0\}/);
  assert.match(crash, /<span className="crash-reports-note" role="status" aria-live="polite">\{note\}<\/span>\s*<\/div>/);
  assert.match(css, /\.crash-reports-actions\.is-quiet \{ margin-bottom: 0; \}/);
});
