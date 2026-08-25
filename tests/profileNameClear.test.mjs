import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const ACCOUNT = read('src/components/AccountSettings.jsx');

function firstNameInput(source) {
  const start = source.indexOf('id="firstName"');
  assert.ok(start >= 0, 'firstName input');
  return source.slice(start, start + 280);
}

function lastNameInput(source) {
  const start = source.indexOf('id="lastName"');
  assert.ok(start >= 0, 'lastName input');
  return source.slice(start, start + 280);
}

test('intended: first/last name can persist back to empty', () => {
  const first = firstNameInput(ACCOUNT);
  const last = lastNameInput(ACCOUNT);
  assert.doesNotMatch(first, /\brequired\b/);
  assert.doesNotMatch(last, /\brequired\b/);
  assert.match(ACCOUNT, /const nextFirstName = \(firstName \|\| ''\)\.trim\(\)/);
  assert.match(ACCOUNT, /const nextLastName = \(lastName \|\| ''\)\.trim\(\)/);
  assert.match(ACCOUNT, /first_name: nextFirstName/);
  assert.match(ACCOUNT, /last_name: nextLastName/);
  assert.match(ACCOUNT, /full_name: \[nextFirstName, nextLastName\]\.filter\(Boolean\)\.join\(' '\)/);
});

test('break: empty names still count as a real change from a saved name', () => {
  assert.match(
    ACCOUNT,
    /nextFirstName !== \(user\?\.user_metadata\?\.first_name \|\| ''\)/,
  );
  assert.match(
    ACCOUNT,
    /nextLastName !== \(user\?\.user_metadata\?\.last_name \|\| ''\)/,
  );
});

test('edge: email stays required-disabled; leftover-18 preview persist still throws', () => {
  const emailStart = ACCOUNT.indexOf('id="email"');
  assert.ok(emailStart >= 0);
  const email = ACCOUNT.slice(emailStart, emailStart + 220);
  assert.match(email, /disabled/);
  const hub = read('src/home/HubPreview.jsx');
  assert.match(hub, /updateProfile: previewBlocked\('save profile changes'\)/);
});
