// Issue #1777: sign-in dialog and sidebar/Projects controls must meet the 44px
// minimum touch target at narrow viewports (<= 767px, covering 640px and 393px)
// without changing compact desktop (>= 768px) sizing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const authCss = read('src/components/AuthModal.css');
const hubCss = read('src/home/hub.css');

function extractMediaBlock(css, query) {
  const header = `@media ${query} {`;
  const start = css.indexOf(header);
  assert.ok(start >= 0, `expected media query block: ${header}`);
  let depth = 0;
  for (let i = start + header.length - 1; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  assert.fail(`unclosed media query block: ${header}`);
}

test('AuthModal enforces >= 44px touch targets at @media (max-width: 767px)', () => {
  const block = extractMediaBlock(authCss, '(max-width: 767px)');

  // Close button box itself is 44x44
  assert.match(block, /\.auth-modal-close\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
  // Email / password / SSO inputs >= 44px tall
  assert.match(block, /\.auth-form-group input\s*\{[^}]*min-height:\s*44px;/s);
  // Forgot password? link >= 44px tall
  assert.match(block, /\.auth-forgot-link\s*\{[^}]*min-height:\s*44px;/s);
  // Sign in, Google, Microsoft buttons >= 44px tall
  assert.match(block, /\.auth-submit-btn,\s*\.auth-google-btn\s*\{[^}]*min-height:\s*44px;/s);
  // Terms of Service & Privacy Policy links >= 44px tall
  assert.match(block, /\.auth-terms-note a,\s*\.auth-terms a\s*\{[^}]*min-height:\s*44px;/s);
  // Secondary auth links/buttons >= 44px tall
  assert.match(block, /\.auth-link-btn,\s*\.auth-sso-link,\s*\.auth-dismiss-btn\s*\{[^}]*min-height:\s*44px;/s);
});

test('AuthModal preserves compact desktop base sizing outside narrow media queries', () => {
  const base = authCss.slice(0, authCss.indexOf('@media (max-width: 767px)'));
  assert.match(base, /\.auth-modal-close\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s);
  assert.match(base, /\.auth-submit-btn\s*\{[^}]*height:\s*40px;/s);
  assert.match(base, /\.auth-google-btn\s*\{[^}]*height:\s*40px;/s);
});

test('Hub enforces >= 44px touch targets for Sign in, New project, and Select at @media (max-width: 767px)', () => {
  const block = extractMediaBlock(hubCss, '(max-width: 767px)');

  // Sidebar Sign in button >= 44px tall
  assert.match(block, /\.survey-hub \.side \.profile-signin\s*\{[^}]*min-height:\s*44px;/s);
  // New project (panel header & empty state) >= 44px tall
  assert.match(block, /\.survey-hub \.hub-new-btn,\s*\.survey-hub \.hub-empty-state \.btn\.primary\s*\{[^}]*min-height:\s*44px;/s);
  // Select icon buttons >= 44x44
  assert.match(
    block,
    /\.survey-hub \.hub-panel-head \.section-icon-btn\.section-icon-btn:not\(\.is-word\)[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/,
  );
  assert.match(
    block,
    /\.survey-hub \.section-icon-btn\.section-icon-btn\.mobile-header-select-button[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/,
  );
});

test('Hub preserves compact desktop base sizing for sidebar Sign in, buttons, and Select', () => {
  const base = hubCss.slice(0, hubCss.indexOf('@media (max-width: 767px)'));
  assert.match(base, /\.survey-hub \.profile-signin\s*\{[^}]*min-height:\s*32px;/s);
  assert.match(base, /\.survey-hub \.btn\s*\{[^}]*height:\s*28px;/s);
  assert.match(base, /\.survey-hub \.section-icon-btn\.section-icon-btn\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;/s);
});
