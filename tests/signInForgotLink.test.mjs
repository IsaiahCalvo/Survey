// KAL-652 batch 21: "Forgot password?" sits on the Password label's row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../src/components/AuthModal.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/AuthModal.css', import.meta.url), 'utf8');

test('Forgot password? is on the Password row, after the field so Tab reaches the password first', () => {
  assert.equal(jsx.match(/Forgot password\?\s*</g).length, 1, 'one Forgot password? link');
  const field = jsx.indexOf('id="password"');
  const link = jsx.indexOf('className="auth-forgot-link"');
  assert.ok(field > 0 && link > field, 'link comes after the password field');
  assert.match(jsx, /auth-form-group\$\{mode === 'login' \? ' has-forgot' : ''\}/);
  assert.match(css, /\.auth-form-group\.has-forgot > \.auth-forgot-link \{ grid-row: 1; grid-column: 2;/);
  assert.match(css, /\.auth-form-group\.has-forgot > input \{ grid-row: 2; grid-column: 1 \/ -1; \}/);
});

test('the foot no longer repeats Forgot password?, and the SSO link drops "(enterprise)"', () => {
  const foot = jsx.slice(jsx.indexOf('<div className="auth-footer">'));
  assert.doesNotMatch(foot, /Forgot password\?/);
  assert.match(jsx, />\s*Sign in with company SSO\s*</);
  assert.doesNotMatch(jsx, /\(enterprise\)/);
});

test('the link is the calm link colour', () => {
  assert.match(css, /\.auth-forgot-link \{[^}]*color: var\(--link\);/);
  assert.match(css, /\.auth-forgot-link:hover \{\s*color: var\(--link-hover\);/);
});

test('sign-up puts First and Last name on one row, stacked on a narrow card', () => {
  assert.match(jsx, /<div className="auth-name-row">[\s\S]{0,200}id="firstName"/);
  assert.match(css, /\.auth-name-row \{\s*display: grid;\s*grid-template-columns: 1fr 1fr;/);
  assert.match(css, /@media \(max-width: 480px\) \{\s*\.auth-name-row \{ grid-template-columns: 1fr;/);
});
