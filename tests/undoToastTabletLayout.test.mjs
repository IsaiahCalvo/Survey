// PR #1106 follow-up: on tablets (768-1366px) and desktop the centred Undo
// toast must clear the Survey panel's 40px Export footer while the panel is
// open, and the app toast stack must stand above the lifted Undo toast.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const TABLET = '@media screen and (min-device-width: 600px) and (min-device-height: 600px)';
const block = (css) => {
  const start = css.indexOf(TABLET);
  assert.ok(start > 0, 'tablet/desktop media block');
  return css.slice(start);
};
const px = (s) => Number(s.match(/bottom:\s*(\d+)px/)[1]);

test('undo toast lifts above the Survey panel footer on tablet/desktop', () => {
  const css = read('../src/components/collab/UndoToast.css');
  const rule = block(css).match(/html:has\(\.survey-rail__foot\) \.undo-toast\s*\{([^}]*)\}/);
  assert.ok(rule, 'lift rule');
  assert.ok(px(rule[1]) >= 40 + 8, 'clears the 40px footer');
  // Never leaks onto phones, whose rules live in the phone block before it.
  assert.ok(css.indexOf(TABLET) > css.indexOf('max-device-width: 599px'));
});

test('footer height the lift is based on is still 40px', () => {
  const css = read('../src/surveyRailPanel.css');
  const rule = css.match(/\.survey-rail \.survey-rail__foot\s*\{([^}]*)\}/);
  assert.match(rule[1], /height:\s*40px/);
});

test('app toast stack stays above the lifted undo toast', () => {
  const undo = px(block(read('../src/components/collab/UndoToast.css')));
  const host = block(read('../src/components/ToastHost.css'))
    .match(/html\[data-undo-toast-open\]:has\(\.survey-rail__foot\) \.app-toast-host\s*\{([^}]*)\}/);
  assert.ok(host, 'stack rule');
  // Undo toast is 44px tall (12px padding + 13px * 1.4 line), plus a gap.
  assert.ok(px(host[1]) >= undo + 44 + 8);
});
