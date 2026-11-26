// Wave 17 phone auth polish guards (#1785, #1786):
// - #1785: Create account "I agree" checkbox has a 44x44px tap target on phone / coarse screens.
// - #1786: On phone widths (<= 767px), Reset password and all other AuthModal views sit
//          top-aligned and fill the viewport height identically to Sign in, while desktop
//          (>= 768px) stays centered and compact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

function extractMediaBlock(css, query) {
  const idx = css.indexOf(query);
  assert.ok(idx !== -1, `missing media block: ${query}`);
  const braceStart = css.indexOf('{', idx);
  assert.ok(braceStart !== -1, `missing opening brace for: ${query}`);
  let depth = 0;
  for (let i = braceStart; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(braceStart + 1, i);
    }
  }
  throw new Error(`unclosed media block: ${query}`);
}

test('#1785: Create account "I agree" checkbox has a 44x44px tap target on phone and touch screens', () => {
  const jsx = read('src/components/AuthModal.jsx');
  assert.match(jsx, /<label className="auth-terms">[\s\S]{0,220}type="checkbox"[\s\S]{0,220}data-auth-terms/);

  const css = read('src/components/AuthModal.css');
  const block = extractMediaBlock(css, '@media (max-width: 767px), (pointer: coarse)');
  assert.match(block, /\.auth-terms\s*\{[^}]*min-height:\s*44px;/);
  assert.match(block, /\.auth-terms input\[type="checkbox"\]\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/);
  assert.match(block, /\.auth-terms input\[type="checkbox"\]\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/);
  assert.match(block, /\.auth-terms input\[type="checkbox"\]::before\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/);
  assert.match(block, /\.auth-terms input\[type="checkbox"\]:checked::before\s*\{[^}]*background:\s*var\(--accent\);/);
  assert.match(block, /\.auth-terms input\[type="checkbox"\]:focus-visible::before\s*\{[^}]*outline:\s*2px solid var\(--focus\);/);
});

test('#1786: phone auth dialog fills the viewport top-aligned across Sign in and Reset password while desktop stays centered', () => {
  const css = read('src/components/AuthModal.css');

  // Desktop base rules remain centered and compact.
  const desktopPrefix = css.slice(0, css.indexOf('@media (max-width: 767px)'));
  assert.match(desktopPrefix, /\.auth-modal-overlay\s*\{[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/);
  assert.match(desktopPrefix, /\.auth-modal\s*\{[^}]*max-width:\s*440px;[^}]*max-height:\s*90dvh;/);

  // Phone layout (<= 767px) stretches top-aligned to fill viewport height so
  // Reset password never floats mid-screen above/below the Projects list.
  const phoneBlock = extractMediaBlock(css, '@media (max-width: 767px)');
  assert.match(phoneBlock, /\.auth-modal-overlay\s*\{[^}]*align-items:\s*stretch;[^}]*padding:\s*0;/);
  assert.match(phoneBlock, /\.auth-modal\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*height:\s*100%;[^}]*min-height:\s*100%;[^}]*max-height:\s*100%;/);
  assert.match(phoneBlock, /\.auth-modal\s*\{[^}]*border-radius:\s*0;[^}]*border:\s*0;/);
  assert.doesNotMatch(phoneBlock, /padding-top:\s*var\(--native-safe-area-top/);
});
