/*
 * sectionHeaderIcons.test.mjs — owner ruling 2026-10-02, reversing the
 * 2026-10-01 quiet words: section header actions such as "Select" and
 * "+ Category" are ICONS, not words ("The icons looked way better").
 *
 * Pins the one shared control (src/components/SectionIconButton.jsx) and that
 * every header that offers these actions uses it:
 *   - the pair: Select = list-checks, Add = plus;
 *   - desktop 28px hit / 16px glyph, phone 44px hit / 18px glyph;
 *   - bare glyph, no plate, NO gold anywhere: a mode toggle that is on
 *     swaps to a check glyph in the same ink, named "Done";
 *   - hover 108% / press 92% (120ms / 80ms): states.css section 5's model;
 *   - the word lives in the accessible name and the tooltip.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const component = read('src/components/SectionIconButton.jsx');
const css = read('src/components/SectionIconButton.css');
const states = read('src/styles/states.css');
const icons = read('src/Icons.jsx');

test('the pair and its sizes live in one place', () => {
  assert.match(component, /select: 'listChecks',\s*add: 'plus',/);
  assert.match(component, /desktop: \{ hit: 28, glyph: 16 \}/);
  assert.match(component, /phone: \{ hit: 44, glyph: 18 \}/);
  assert.match(icons, /listChecks: \(size, color, style, className\) =>/);
  // Desktop 28 / 16; phone 36px box + 4px pad each side = 44, glyph 18.
  assert.match(css, /\.section-icon-btn \{[^}]*width: 28px;[^}]*height: 28px;/);
  assert.match(css, /\.section-icon-btn > svg \{[^}]*width: 16px;/);
  assert.match(css, /\.section-icon-btn\.is-phone \{[^}]*width: 36px;/);
  assert.match(css, /\.section-icon-btn\.is-phone::after \{[^}]*inset: -4px;/);
  assert.match(css, /\.section-icon-btn\.is-phone > svg \{[^}]*width: 18px;/);
  // Bare: no plate, and no gold anywhere (owner) - not even for a mode
  // that is on; that one swaps to the check "Done" glyph in the same ink.
  assert.match(css, /\.section-icon-btn \{[^}]*background: transparent;[^}]*color: var\(--text-2\);/);
  assert.doesNotMatch(css, /--accent|--gold/);
  assert.match(component, /export const SECTION_DONE_ICON = 'check';/);
  assert.match(component, /name=\{active \? SECTION_DONE_ICON : /);
});

test('the word is the accessible name and the tooltip', () => {
  assert.match(component, /aria-label=\{label\}/);
  assert.match(component, /bindTooltip \? bindTooltip\(tip, tooltipPlacement\) : \{ title: tip \}/);
  // Marked glyph-only from the first paint, so states.css's no-plate press
  // applies before the DOM watcher runs.
  assert.match(component, /data-glyph-only=""/);
});

test('hover and press are states.css section 5 values: 108% / 92%, 120ms / 80ms', () => {
  const s5 = states.slice(states.indexOf('5. CHROME ICON BUTTONS'));
  // The chrome model itself...
  assert.match(s5, /:hover > :not\(\[data-anchored-tooltip\]\) \{\s*scale: 1\.08;/);
  assert.match(s5, /:active > :not\(\[data-anchored-tooltip\]\) \{\s*scale: 0\.92;\s*transition-duration: 80ms;/);
  // ...and the section icons on the same numbers.
  assert.match(s5, /\.section-icon-btn > svg \{\s*transition:\s*scale 120ms cubic-bezier\(0\.33, 1, 0\.68, 1\)/);
  assert.match(s5, /\.section-icon-btn:not\(:disabled\):hover > svg \{\s*scale: 1\.08;/);
  assert.match(s5, /\.section-icon-btn:not\(:disabled\):active > svg \{\s*scale: 0\.92;\s*transition-duration: 80ms;/);
  // No separate 112% / 88% transform for them: both older glyph rules skip them.
  assert.doesNotMatch(states, /^\s*\.section-icon-btn[^{]*\{[^}]*scale\((1\.12|0\.88)\)/m);
  assert.match(states, /\.survey-hub \[data-glyph-only\]:not\(\.hero-swatch\):not\(\.section-icon-btn\)[^{]*:hover:not\(:active\) > \* \{\s*transform: scale\(1\.12\);/);
  assert.match(states, /\[data-glyph-only\]:where\(:not\([^)]*\.section-icon-btn\)\):not\(:disabled\):active > \* \{ transform: scale\(0\.88\); \}/);
});

test('every list header with Select / Add uses the shared icon, never a word', () => {
  const files = {
    'src/home/TemplatesEditor.jsx': ['label="Add category"', 'label="Add entity"', 'label="Add module"'],
    'src/home/ProjectsFolderTree.jsx': ['label="Add files"', 'label="Manage team"'],
    'src/home/DocumentsLedger.jsx': [],
    'src/home/ArchiveScreen.jsx': [],
    'src/sidebar/BookmarksPanel.jsx': ['label="Add bookmark"'],
    'src/sidebar/SpacesPanel.jsx': ['label={createSpaceLabel}'],
  };
  for (const [file, labels] of Object.entries(files)) {
    const source = read(file);
    assert.match(source, /import SectionIconButton(, \{ [A-Za-z, ]+ \})? from '\.\.\/components\/SectionIconButton\.jsx';/, file);
    assert.doesNotMatch(source, /\? 'Done' : 'Select'\}\s*<\/button>/, `${file}: no Select word button`);
    assert.doesNotMatch(source, />Select<\/button>/, `${file}: no Select word`);
    for (const label of labels) assert.ok(source.includes(label), `${file}: ${label}`);
  }
  // The New template / New project primaries stay the page's one gold button.
  assert.match(read('src/home/TemplatesEditor.jsx'), /<Icon name="plus" size=\{11\} \/>New template/);
  assert.match(read('src/home/ProjectsFolderTree.jsx'), /<Icon name="plus" size=\{11\} \/>New project/);
});

test('select-mode action row: All, Duplicate, Move, Copy, Share, Delete - one component (owner 2026-10-02)', () => {
  // Order and icons live in SectionIconButton.jsx only.
  assert.match(component, /duplicate: 'duplicate',\s*move: 'moveTo',\s*copy: 'copy',\s*share: 'share',\s*delete: 'trash',/);
  const order = [...component.matchAll(/\{ key: '(\w+)', label: '(\w+)', handler: '(\w+)' \}/g)].map((m) => m[2]);
  assert.deepEqual(order, ['Duplicate', 'Move', 'Copy', 'Share', 'Delete']);
  // "All" is the one word, on the same button: 13px / 500, same 28px box.
  assert.match(component, /word=\{allSelected \? 'None' : 'All'\}/);
  assert.match(css, /\.section-icon-btn__word \{[^}]*font-size: 13px;[^}]*font-weight: 500;/);
  // The provisional Move glyph is defined once, in Icons.jsx.
  assert.equal((icons.match(/moveTo: \(size, color, style, className\) =>/g) || []).length, 1);
  assert.match(icons, /strokeDasharray="1\.5 3"/);
  // Disabled = calm: the hover / press only run on :not(:disabled).
  assert.match(states, /\.section-icon-btn:not\(:disabled\):hover > \.section-icon-btn__word \{\s*scale: 1\.08;/);
  // Every select row uses it; no "Move/Copy" word button or old bare/icon kinds left.
  for (const file of ['src/home/TemplatesEditor.jsx', 'src/home/ProjectsFolderTree.jsx', 'src/home/DocumentsLedger.jsx', 'src/SurveySpacesRail.jsx']) {
    const source = read(file);
    assert.match(source, /<SelectModeButtons/, file);
    assert.doesNotMatch(source, />Move\/Copy<\/button>/, file);
    assert.doesNotMatch(source, /className="hub-btn hub-btn--bare">Duplicate<\/button>/, file);
    assert.doesNotMatch(source, /className="hub-btn hub-btn--icon is-danger"/, file);
  }
});
