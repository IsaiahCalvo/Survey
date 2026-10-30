// Finger-sized targets on the desktop layout (Drawboard touch audit
// 2026-10-13, S1-S4 / M3; src/styles/touchTargets.css).
//
// iPads and touch laptops use the desktop layout. The chrome is drawn for a
// mouse (median 28px measured at 1024x1366 touch), so touch screens get
// invisible hit zones and touch-first screens get the room for them - and a
// desktop with a mouse must not change at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EDGE_CLEARANCE,
  WIDEST_SUBTOOLS_WIDTH,
  planTopBar,
  widestSubtoolsWidth,
} from '../src/utils/responsiveToolbar.js';
import { DESKTOP_LAYOUT_MEDIA } from '../src/utils/layoutMode.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Top-level blocks: [{ prelude, body }] (brace matching, comments removed). */
function topLevelBlocks(css) {
  const text = stripComments(css);
  const out = [];
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '{') {
      if (depth === 0) open = i;
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        out.push({ prelude: text.slice(start, open).trim(), body: text.slice(open + 1, i) });
        start = i + 1;
      }
    }
  }
  return out;
}

const TOUCH_CSS = read('src/styles/touchTargets.css');
const TIER2 = `@media ${DESKTOP_LAYOUT_MEDIA} and (pointer: coarse)`;
const CSS = stripComments(TOUCH_CSS);

test('a desktop with a mouse matches nothing: every rule sits behind a touch query, except the touch-opened menu rows', () => {
  const blocks = topLevelBlocks(TOUCH_CSS);
  const outside = blocks.filter((b) => !b.prelude.startsWith('@media'));
  assert.deepEqual(outside.map((b) => b.prelude), ["[data-annotation-context-menu][data-touch-rows='true'] [role='menuitem']"]);
  for (const b of blocks.filter((x) => x.prelude.startsWith('@media'))) {
    assert.ok(
      b.prelude === '@media (any-pointer: coarse)' || b.prelude.startsWith(TIER2),
      `unexpected query: ${b.prelude}`,
    );
  }
  // Loaded by the app (after the token and state sheets).
  assert.match(read('src/styles.css'), /@import '\.\/styles\/swatches\.css';\s*\n(?:\/\*[^*]*\*\/\s*\n)?@import '\.\/styles\/touchTargets\.css';/);
});

test('tier 1 (any touch screen) draws nothing and moves nothing: only transparent ::after zones and their position', () => {
  const tier1 = topLevelBlocks(TOUCH_CSS).find((b) => b.prelude === '@media (any-pointer: coarse)');
  assert.ok(tier1);
  const decls = [...tier1.body.matchAll(/([a-z-]+)\s*:\s*[^;{}]+;/g)].map((m) => m[1]);
  const allowed = new Set(['position', 'content', 'top', 'bottom', 'left', 'right', 'inset', 'border-radius', '--quick-style-hit-inset', '--rail-zone-gap']);
  assert.deepEqual([...new Set(decls.filter((d) => !allowed.has(d)))], [], 'no visual property in tier 1');
  assert.doesNotMatch(tier1.body, /background|(?<![-\w])(?:color|width|height|gap)\s*:|margin|padding/);
});

test('tier 2 (touch-first, desktop layout) gives the room: 44px bars, menu rows and list rows; wider rail and colour gaps', () => {
  assert.ok(CSS.includes(`${TIER2} {`));
  assert.match(CSS, /html:root \{[^}]*--chrome-bar-h: 44px;[^}]*--chrome-menu-row-h: 44px;[^}]*--row-h: 44px;[^}]*--row-h-sub: 44px;/);
  assert.match(CSS, /\[role='menu'\] :is\(\[role='menuitem'\], \[role='menuitemradio'\], \[role='menuitemcheckbox'\]\) \{\s*min-height: 44px !important;/);
  assert.match(CSS, /#chrome-right-host \[data-chrome-rail\]:not\(\.survey-rail-strip\) \{\s*gap: 22px !important;\s*--rail-zone-gap: 22px;/);
  // The tool gutter opens only where the widest loadout still fits.
  assert.ok(CSS.includes(`${TIER2} and (min-width: 680px) {\n  #chrome-top-host {\n    --chrome-tool-gap: 12px;`));
});

test('zones never reach into a neighbour: half the gutter each side, the rail zones half the stack gap', () => {
  assert.match(CSS, /left: calc\(var\(--chrome-tool-gap\) \/ -2\);\s*right: calc\(var\(--chrome-tool-gap\) \/ -2\);/);
  assert.match(CSS, /left: calc\(var\(--chrome-gap\) \/ -2\);/);
  assert.match(CSS, /top: calc\(var\(--rail-zone-gap, 4px\) \/ -2\);\s*bottom: calc\(var\(--rail-zone-gap, 4px\) \/ -2\);/);
  // Popovers and menus that render inside a bar or a rail keep their own boxes.
  assert.ok((CSS.match(/:not\(:is\(\[role='dialog'\], \[role='menu'\], \[role='listbox'\]\) \*\)/g) || []).length >= 6);
});

test('the survey bar\'s "All N" chips take a finger: the bar\'s height, inside the tightest gutter (batch-7 tablet check)', () => {
  const tier1 = topLevelBlocks(TOUCH_CSS).find((x) => x.prelude === '@media (any-pointer: coarse)');
  const body = stripComments(tier1.body);
  assert.match(body, /#chrome-survey-row-slot \.survey-row-all \{\s*position: relative;\s*\}/);
  assert.match(body, /#chrome-survey-row-slot \.survey-row-all::after \{\s*content: '';\s*position: absolute;\s*top: calc\(50% - var\(--chrome-bar-h\) \/ 2\);\s*bottom: calc\(50% - var\(--chrome-bar-h\) \/ 2\);\s*left: -2px;\s*right: -2px;/);
});

test('the tool bar plan keeps the wider loadout clear of Export', () => {
  assert.equal(widestSubtoolsWidth(), WIDEST_SUBTOOLS_WIDTH);
  assert.equal(widestSubtoolsWidth(6), 283);
  assert.equal(widestSubtoolsWidth(12), 8 * 28 + 7 * 12 + 17);
  assert.equal(widestSubtoolsWidth(Number.NaN), 283);
  // An iPad mini (744px) with the 12px gutter: Undo/Redo end at 78, Pan /
  // Select 85px, the icons 108px, Export at 706.
  const reserve = widestSubtoolsWidth(12) + 28 + 12;
  const plan = planTopBar({ barWidth: 744, startRight: 78, leftBlockWidth: 85, exportLeft: 706, clusterWidth: 108, loadoutReserve: reserve });
  assert.ok(plan.clusterLeft + 108 + reserve + EDGE_CLEARANCE <= 706 + 0.5, `loadout clears Export (${plan.clusterLeft})`);
  assert.ok(plan.clusterLeft >= 78 + 12 + 85, 'and Pan / Select stay clear of Undo / Redo');
  const hook = read('src/hooks/useResponsiveToolbar.js');
  assert.match(hook, /getPropertyValue\('--chrome-tool-gap'\)/);
  assert.match(hook, /loadoutReserve: widestSubtoolsWidth\(toolGap\) \+ surveyRoom/);
  // Design review 2026-10-27 (820px tablet): Export keeps at least the tool
  // gutter from the last tool, never the 8px floor against a 12px gutter.
  assert.match(hook, /edgeClearance: Math\.max\(EDGE_CLEARANCE, toolGap\)/);
  const wide = planTopBar({ barWidth: 820, startRight: 78, leftBlockWidth: 85, exportLeft: 754, clusterWidth: 108, loadoutReserve: reserve, edgeClearance: 12 });
  assert.ok(wide.clusterLeft + 108 + reserve + 12 <= 754 + 0.5, `12px before Export (${wide.clusterLeft})`);
});

test('the fit menu is a menu (so its rows take the 44px touch rows)', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /<div role="menu" aria-label="Fit modes"/);
  assert.match(shell, /role="menuitemradio"\s*\n\s*aria-checked=\{isActive\}/);
});

test('hover paints in the chrome sheets are behind @media (hover: hover), so a tap leaves nothing lit', () => {
  const files = [
    'src/TabBar.css',
    'src/components/AnnotationDropdown.css',
    'src/components/AnnotationSizeControl.css',
    'src/components/QuickStyleControls.css',
    'src/components/SurveyPickList.css',
    'src/components/pencilModeControl.css',
  ];
  for (const file of files) {
    const loose = topLevelBlocks(read(file)).filter((b) => !b.prelude.startsWith('@') && b.prelude.includes(':hover'));
    assert.deepEqual(loose.map((b) => b.prelude), [], `${file}: ungated hover`);
  }
  const styles = topLevelBlocks(read('src/styles.css'));
  const gated = new Set(styles.filter((b) => b.prelude === '@media (hover: hover)').map((b) => b.body.replace(/\s+/g, ' ')));
  const gatedText = [...gated].join('\n');
  for (const sel of ['.chrome-pill:hover', '.chrome-text-toggle:hover', '.chrome-segmented > button:hover', '.chrome-history:not(:disabled):hover', '.btn-ghost:hover:not(:disabled)', '.survey-subrow__done:hover']) {
    assert.ok(gatedText.includes(sel), `${sel} is gated`);
    assert.ok(!styles.some((b) => !b.prelude.startsWith('@') && b.prelude.split(',').map((s) => s.trim()).includes(sel)), `${sel} is not also loose`);
  }
  // Focus and open states keep their look (only the hover half moved).
  assert.match(read('src/TabBar.css'), /\.tab-strip-overflow\[aria-expanded='true'\] \{/);
  assert.match(read('src/components/AnnotationSizeControl.css'), /\.annotation-size-control__trigger\[data-state='open'\] \{/);
});

test('the Move / Copy dialog\'s mode buttons take the 44px dialog-touch-pad on a touch screen (28px painted)', () => {
  const src = read('src/home/BulkModals.jsx');
  const modeBtn = src.slice(src.indexOf('const modeBtn'), src.indexOf('return (', src.indexOf('const modeBtn')));
  assert.match(modeBtn, /onClick=\{\(\) => setMode\(val\)\}/);
  assert.match(modeBtn, /className="dialog-touch-pad"/);
  assert.match(modeBtn, /height: 28/);
  const hub = stripComments(read('src/home/hub.css'));
  assert.match(hub, /@media \(pointer: coarse\)[\s\S]*\.dialog-touch-pad::after\s*\{[^}]*inset:\s*-9px 0/);
});
