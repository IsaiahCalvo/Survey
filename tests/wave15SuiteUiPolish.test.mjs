// Wave 15 proactive SUITE-RULES.md UI / contrast / a11y polish guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

function walkCss(dir = 'src', out = []) {
  for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (['node_modules', '__tests__', 'vendor', 'prototype'].includes(entry.name)) continue;
      walkCss(rel, out);
    } else if (/\.css$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function contrastRatio(fgHex, bgHex) {
  const lum = ({ r, g, b }) => {
    const ch = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const l1 = lum(hexToRgb(fgHex));
  const l2 = lum(hexToRgb(bgHex));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test('enabled input/textarea placeholders use --text-3 (>= 4.5:1) instead of browser default or --text-disabled', () => {
  const states = read('src/styles/states.css');
  assert.match(states, /:is\(input, textarea\):not\(:disabled\):not\(\[aria-disabled='true'\]\)::placeholder\s*\{\s*color:\s*var\(--text-3\);\s*opacity:\s*1;\s*\}/);
  assert.match(states, /\.auth-form-group input:not\(:disabled\)::placeholder,\s*\.survey-hub \.templates-mobile-inline-input:not\(:disabled\)::placeholder\s*\{\s*color:\s*var\(--text-3\);\s*opacity:\s*1;\s*\}/);

  const accountCss = read('src/components/AccountSettings.css');
  assert.match(accountCss, /\.account-form-group input::placeholder\s*\{\s*color:\s*var\(--text-3\);/);
  assert.match(accountCss, /\.account-form-group input:disabled::placeholder\s*\{\s*color:\s*var\(--text-disabled\);/);

  const templatesCss = read('src/home/TemplatesEditor.css');
  assert.match(templatesCss, /\.ed-scope \.inline-edit::placeholder\s*\{\s*color:\s*var\(--text-3\);/);

  // Verify --text-3 clears WCAG AA 4.5:1 on every dark surface in both palettes.
  const tokens = read('src/styles/tokens.css');
  const [defaultBlock, suiteBlock] = tokens.split('html[data-look="suite"] {');
  for (const [label, block] of [['default', defaultBlock], ['suite', suiteBlock]]) {
    const text3 = /--text-3:\s*(#[0-9a-fA-F]{6})/.exec(block)?.[1];
    assert.ok(text3, `${label} --text-3 hex found`);
    for (const surface of ['--surface-0', '--surface-1', '--surface-2', '--surface-3']) {
      const bg = new RegExp(`${surface}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1];
      assert.ok(bg, `${label} ${surface} hex found`);
      const ratio = contrastRatio(text3, bg);
      assert.ok(ratio >= 4.5, `${label} --text-3 (${text3}) on ${surface} (${bg}) = ${ratio.toFixed(2)}:1 < 4.5:1`);
    }
  }
});

test('aria-controls on sync status chips and mobile survey template button are only set when target is mounted', () => {
  const desktopSync = read('src/components/SyncStatusChip.jsx');
  assert.doesNotMatch(desktopSync, /aria-controls="sync-status-details"/);
  assert.equal((desktopSync.match(/aria-controls=\{detailsOpen \? 'sync-status-details' : undefined\}/g) || []).length, 2);
  assert.equal((desktopSync.match(/data-sync-status-chip=""/g) || []).length, 2);

  const states = read('src/styles/states.css');
  assert.match(states, /\[data-sync-status-chip\]/);

  const mobileChrome = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.doesNotMatch(mobileChrome, /aria-controls="mobile-sync-status-details"/);
  assert.match(mobileChrome, /aria-controls=\{sync\.state !== 'synced' && syncDetailsOpen \? 'mobile-sync-status-details' : undefined\}/);

  const surveyRail = read('src/SurveySpacesRail.jsx');
  assert.doesNotMatch(surveyRail, /aria-controls="survey-template-list"/);
  assert.match(surveyRail, /aria-controls=\{isMobileTemplateSwitching \? 'survey-template-list' : undefined\}/);
});

test('BookmarksPanel modal close icon buttons carry accessible names and type="button"', () => {
  const src = read('src/sidebar/BookmarksPanel.jsx');
  assert.match(src, /New folder\s*<\/h3>\s*<button\s+type="button"\s+aria-label="Close"/);
  assert.match(src, /Add bookmarks to group\s*<\/h3>\s*<button\s+type="button"\s+aria-label="Close"/);
});

test('no undefined --focus-ring or --hover-bg tokens remain in src/ CSS and shared focus/state tokens are used', () => {
  const offenders = [];
  for (const rel of walkCss('src')) {
    const css = read(rel);
    if (/var\(--focus-ring\b/.test(css)) offenders.push(`${rel} uses undefined --focus-ring`);
    if (/var\(--hover-bg\b/.test(css)) offenders.push(`${rel} uses undefined --hover-bg`);
  }
  assert.deepEqual(offenders, []);

  const paper = read('src/styles/paperOverlays.css');
  assert.match(paper, /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*\.paper-overlay-swatch:hover:not\(:active\) \{ background: var\(--hover\);/);
  assert.match(paper, /\.paper-overlay-swatch:focus-visible \{ outline: 2px solid var\(--focus\);/);

  const note = read('src/sidebar/AccountNeededNote.css');
  assert.match(note, /border: 1px solid var\(--border-strong\);/);
  assert.match(note, /\.account-needed-note__btn:not\(:disabled\):hover:not\(:active\) \{ background: var\(--hover\); \}/);
  assert.match(note, /\.account-needed-note__btn:not\(:disabled\):active \{ background: var\(--pressed\); transition: none; \}/);
  assert.match(note, /\.account-needed-note__btn:focus-visible \{ outline: 2px solid var\(--focus\);/);
  assert.doesNotMatch(note, /scale\(0\.98\)|--ink-(500|600|700)/);

  const ruler = read('src/components/RulerLayer.css');
  assert.match(ruler, /\.survey-ruler__close:hover:not\(:active\) \{ background: var\(--hover\);/);
  assert.match(ruler, /\.survey-ruler__close:focus-visible, \.survey-ruler__turn:focus-visible \{ outline: 2px solid var\(--focus\);/);

  const tracking = read('src/components/surveyMarkerTracking.css');
  assert.match(tracking, /\.survey-tracking__activity-toggle:focus-visible \{\s*outline: 2px solid var\(--focus\);/);
});

test('disabled buttons do not paint hover or press states in shared chrome and panel sheets', () => {
  const styles = read('src/styles.css');
  assert.match(styles, /\.chrome-pill:not\(:disabled\):not\(\[aria-disabled='true'\]\):hover:not\(:active\)/);
  assert.match(styles, /\.chrome-pill:not\(:disabled\):not\(\[aria-disabled='true'\]\):active/);
  assert.match(styles, /\.survey-subrow__template \.chrome-pill:not\(:disabled\):not\(\[aria-disabled='true'\]\):hover:not\(:active\)/);

  const sizeCtrl = read('src/components/AnnotationSizeControl.css');
  assert.match(sizeCtrl, /\.annotation-size-control__trigger:not\(:disabled\):hover:not\(:active\)/);
  assert.match(sizeCtrl, /\.annotation-size-control__trigger:disabled\s*\{[^}]*cursor:\s*not-allowed;/);

  const railFlyout = read('src/components/RailFlyout.css');
  assert.match(railFlyout, /\.rail-flyout__step:not\(:disabled\):not\(\[aria-disabled='true'\]\):active/);

  const notes = read('src/components/surveyMarkerNotes.css');
  assert.match(notes, /\.survey-notes__media-btn:not\(:disabled\):active > svg/);
  assert.match(notes, /\.survey-media-sheet__group > button:not\(:disabled\):active/);
  assert.match(notes, /\.survey-media-menu > button:disabled\s*\{[^}]*cursor:\s*not-allowed;/);

  const mobileSurvey = read('src/mobile/mobileSurveyPanel.css');
  assert.match(mobileSurvey, /\.mobile-survey-sheet-export-menu > button:not\(:disabled\):active/);
});

test('MarkLibraryPanel and HomeLibraryBits keep tile trigger and More button as siblings (no nested interactive elements)', () => {
  const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea']);
  const INTERACTIVE_ROLES = new Set(['button', 'link', 'tab', 'radio', 'checkbox', 'switch', 'menuitem', 'option']);

  const walkAst = (node, parents, fn) => {
    if (!node || typeof node.type !== 'string') return;
    fn(node, parents);
    parents.push(node);
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach((child) => walkAst(child, parents, fn));
      else if (value && typeof value.type === 'string') walkAst(value, parents, fn);
    }
    parents.pop();
  };

  const roleOf = (open) => {
    const attr = open.attributes.find((a) => a.type === 'JSXAttribute' && a.name?.name === 'role');
    return attr?.value?.type === 'StringLiteral' ? attr.value.value : null;
  };

  for (const rel of ['src/markLibrary/MarkLibraryPanel.jsx', 'src/home/HomeLibraryBits.jsx']) {
    const ast = parse(read(rel), { sourceType: 'module', plugins: ['jsx'] });
    const nested = [];
    walkAst(ast, [], (node, parents) => {
      if (node.type !== 'JSXElement' || node.openingElement.name.type !== 'JSXIdentifier') return;
      const tag = node.openingElement.name.name;
      if (!/^[a-z]/.test(tag)) return;
      const role = roleOf(node.openingElement);
      if (!INTERACTIVE_TAGS.has(tag) && !INTERACTIVE_ROLES.has(role)) return;
      for (let i = parents.length - 1; i >= 0; i -= 1) {
        const p = parents[i];
        if (p.type !== 'JSXElement' || p.openingElement.name.type !== 'JSXIdentifier') continue;
        const ptag = p.openingElement.name.name;
        if (!/^[a-z]/.test(ptag)) continue;
        const prole = roleOf(p.openingElement);
        if (INTERACTIVE_TAGS.has(ptag) || INTERACTIVE_ROLES.has(prole)) {
          nested.push(`${rel}:${node.openingElement.loc.start.line} <${tag}> inside <${ptag}${prole ? ` role=${prole}` : ''}>`);
          break;
        }
      }
    });
    assert.deepEqual(nested, [], `nested interactive elements found in ${rel}`);
  }
});
