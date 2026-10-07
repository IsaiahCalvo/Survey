import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * UNDERLINED TEXT LINKS ARE CALM GREY, NEVER GOLD (owner 2026-10-04).
 *
 * Sign in ("Sign in with company SSO", "Create an account", "Forgot
 * password?"), the re-sign-in dialog's "Forgot password?" and Settings'
 * "Forgot your current password?" were gold underlined text. They now use the
 * --link / --link-hover tokens (grey at rest, heading white on hover).
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const rule = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `${selector} rule exists`);
  return css.slice(at, css.indexOf('}', at));
};

test('tokens define a calm link colour pair', () => {
  const tokens = read('src/styles/tokens.css');
  assert.match(tokens, /--link:\s*var\(--text-2\);/);
  assert.match(tokens, /--link-hover:\s*var\(--text-1\);/);
});

test('sign-in links use the link token, not gold', () => {
  const css = read('src/components/AuthModal.css');
  for (const selector of ['.auth-sso-link', '.auth-link-btn']) {
    assert.match(rule(css, selector), /color:\s*var\(--link\);/, selector);
  }
  assert.match(rule(css, '.auth-sso-link:hover:not(:disabled)'), /var\(--link-hover\)/);
  assert.match(rule(css, '.auth-link-btn:hover'), /var\(--link-hover\)/);
  assert.match(rule(read('src/components/collab/ReSignInModal.css'), '.re-signin-modal__link-primary'), /color:\s*var\(--link\);/);
});

test('Settings reset link is the calm link, not an inline gold colour', () => {
  const jsx = read('src/components/AccountSettings.jsx');
  const at = jsx.indexOf('Forgot your current password? Email me a reset link');
  const button = jsx.slice(jsx.lastIndexOf('<button', at), at);
  assert.match(button, /className="account-text-link"/);
  assert.doesNotMatch(button, /--accent/);
  assert.match(rule(read('src/components/AccountSettings.css'), '.account-text-link'), /color:\s*var\(--link\);/);
});

test('Undo toast and storage banner links are the calm link too', () => {
  const undo = read('src/components/collab/UndoToast.css');
  assert.match(rule(undo, '.undo-toast__action'), /color:\s*var\(--link\);/);
  assert.match(rule(undo, '.undo-toast__action:hover'), /color:\s*var\(--link-hover\);/);
  const banner = read('src/components/collab/StorageFailureBanner.css');
  assert.match(rule(banner, '.storage-banner__action'), /color:\s*var\(--link\);/);
});
