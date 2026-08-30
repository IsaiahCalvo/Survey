import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/components/AccountSettings.css', import.meta.url), 'utf8');
const jsx = readFileSync(new URL('../src/components/AccountSettings.jsx', import.meta.url), 'utf8');

test('mobile account settings uses a compact full-width three-column tab row', () => {
  const mobile = css.slice(css.indexOf('@media (max-width: 768px)'));
  const sidebar = mobile.slice(
    mobile.indexOf('.account-settings-sidebar'),
    mobile.indexOf('.account-sidebar-btn'),
  );
  assert.match(sidebar, /flex:\s*0\s+0\s+48px/);
  assert.match(sidebar, /height:\s*48px/);
  assert.match(sidebar, /min-height:\s*48px/);
  assert.match(sidebar, /justify-content:\s*center/);
  assert.match(sidebar, /align-items:\s*stretch/);
  assert.match(sidebar, /padding:\s*0/);
  assert.match(sidebar, /gap:\s*0/);

  const button = mobile.slice(
    mobile.indexOf('.account-sidebar-btn'),
    mobile.indexOf('.account-sidebar-btn.active'),
  );
  assert.match(button, /display:\s*flex/);
  assert.match(button, /align-items:\s*center/);
  assert.match(button, /justify-content:\s*center/);
  assert.match(button, /text-align:\s*center/);
  assert.match(button, /width:\s*33\.333%/);
  assert.match(button, /max-width:\s*none/);
});

test('account settings nav exposes tab semantics', () => {
  assert.match(jsx, /className="account-settings-sidebar"[\s\S]{0,120}role="tablist"/);
  assert.equal((jsx.match(/role="tab"/g) || []).length, 3);
  assert.equal((jsx.match(/aria-selected=\{/g) || []).length, 3);
});
