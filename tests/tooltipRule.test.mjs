// The app's tooltip rule (docs/TOOLTIP-RULES.md, owner 2026-10-22): every
// hover hint is the ONE shared chip from src/components/Tooltip.jsx, with one
// timing (wait once, then show the rest at once), one look and one set of
// keyboard/touch behaviors. This file fails the build on anything that would
// bring back a second kind of tooltip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from '@babel/parser';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFile(path.join(repoRoot, rel), 'utf8');

const TOOLTIP_MODULE = 'src/components/Tooltip.jsx';

async function sourceFiles(dir = 'src', exts = /\.(jsx|tsx|js|ts|mjs)$/) {
  const out = [];
  const entries = await readdir(path.join(repoRoot, dir), { withFileTypes: true });
  for (const entry of entries) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'vendor') continue;
      out.push(...await sourceFiles(rel, exts));
    } else if (exts.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value.type === 'string') walk(value, visit);
  }
}

test('T1: no native title= tooltip on any DOM element in src/', async () => {
  const offenders = [];
  for (const rel of await sourceFiles('src', /\.(jsx|tsx)$/)) {
    const code = await read(rel);
    if (!/\btitle=/.test(code)) continue;
    const ast = parse(code, { sourceType: 'module', plugins: ['jsx', ...(rel.endsWith('.tsx') ? ['typescript'] : [])] });
    walk(ast, (node) => {
      // Lower-case JSX names are DOM elements; <Modal title=…> is a component prop.
      if (node.type !== 'JSXOpeningElement' || node.name.type !== 'JSXIdentifier') return;
      if (!/^[a-z]/.test(node.name.name)) return;
      // <iframe title> names the frame for screen readers; it is not a hover hint.
      if (node.name.name === 'iframe') return;
      node.attributes.forEach((attr) => {
        if (attr.type === 'JSXAttribute' && attr.name.name === 'title') {
          offenders.push(`${rel}:${attr.loc.start.line} <${node.name.name} title=…>`);
        }
      });
    });
  }
  assert.deepEqual(offenders, [], 'use the shared tooltip: {...tip(text, side)} from components/Tooltip.jsx (docs/TOOLTIP-RULES.md)');
});

test('T1: no title set from DOM code, no hand-painted chip, no tooltip library', async () => {
  const offenders = [];
  for (const rel of await sourceFiles()) {
    if (rel === TOOLTIP_MODULE) continue;
    const code = await read(rel);
    code.split('\n').forEach((line, i) => {
      const at = `${rel}:${i + 1}`;
      // el.title = '…' (but not document.title, the browser tab's name).
      if (/\b(button|btn|el|element|node|span|div|link|anchor)\.title\s*=(?!=)/.test(line)) {
        offenders.push(`${at} sets .title on an element`);
      }
      if (/setAttribute\(\s*['"]title['"]/.test(line)) offenders.push(`${at} setAttribute('title')`);
      // Only Tooltip.jsx turns a chip on; everyone else goes through the binder.
      if (/setTooltip\??\.?\(\{\s*visible:\s*true/.test(line)) offenders.push(`${at} paints its own chip`);
      if (/from ['"](react-tooltip|@radix-ui\/react-tooltip|tippy\.js|@tippyjs\/react|react-tippy)['"]/.test(line)) {
        offenders.push(`${at} imports a tooltip library`);
      }
    });
  }
  assert.deepEqual(offenders, []);
  const pkg = JSON.parse(await read('package.json'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.deepEqual(deps.filter((name) => /tooltip|tippy/i.test(name)), [], 'no tooltip library: the app has one tooltip');
});

test('T1: role="tooltip" is only the survey marker review popover', async () => {
  // That card has buttons inside it, so it is a popover (docs/TOOLTIP-RULES.md,
  // "Not a tooltip"), and its class keeps the old name.
  const found = [];
  for (const rel of await sourceFiles('src', /\.(jsx|tsx)$/)) {
    const code = await read(rel);
    code.split('\n').forEach((line, i) => {
      if (/role=["']tooltip["']/.test(line)) found.push(`${rel}:${i + 1}`);
    });
  }
  assert.equal(found.length, 1, found.join('\n'));
  assert.match(found[0], /^src\/SurveySpacesRail\.jsx:/);
});

test('T2: wait once, then show the rest at once, shared by every binder', async () => {
  const src = await read(TOOLTIP_MODULE);
  assert.match(src, /export const TOOLTIP_DELAY_MS = \d+;/);
  assert.match(src, /export const TOOLTIP_WARM_MS = \d+;/);
  // Module-level, so the viewer's, the tab strip's and the hub's binders share it.
  assert.match(src, /^const tooltipTiming = \{ pendingTimer: null, chipShown: false, warmUntil: 0 \};/m);
  assert.match(src, /if \(isFocus \|\| tooltipTiming\.chipShown \|\| nowMs\(\) < tooltipTiming\.warmUntil\) \{\s*paint\(\);\s*\} else \{\s*tooltipTiming\.pendingTimer = setTimeout\(paint, TOOLTIP_DELAY_MS\);/);
  // Leaving starts the warm window and cancels a chip still waiting.
  assert.match(src, /function noteChipHidden\(\) \{\s*cancelPendingShow\(\);/);
});

test('T3/T7: one look, never the accessible name', async () => {
  const src = await read(TOOLTIP_MODULE);
  assert.match(src, /export const TOOLTIP_SURFACE = \{/);
  assert.match(src, /maxWidth: '320px'/);
  assert.match(src, /aria-hidden="true"/);
});

test('T5: touch and pen never raise a chip', async () => {
  const src = await read(TOOLTIP_MODULE);
  assert.match(src, /if \(e\?\.pointerType && e\.pointerType !== 'mouse'\) return;/);
  assert.match(src, /onPointerDown: hideOnPress/);
});

test('T8: every document tab shows its full name on hover', async () => {
  const tabBar = await read('src/TabBar.jsx');
  assert.match(tabBar, /\{\.\.\.tip\(tab\.name, 'below'\)\}/);
  assert.doesNotMatch(tabBar, /truncatedNameTip/, 'the tab name chip is no longer only for cut-short names');
});

test('the rule is written down where agents look', async () => {
  const doc = await read('docs/TOOLTIP-RULES.md');
  for (const rule of ['**T1', '**T2', '**T3', '**T4', '**T5', '**T6', '**T7', '**T8']) {
    assert.ok(doc.includes(rule), `docs/TOOLTIP-RULES.md lists ${rule}`);
  }
  assert.match(await read('CLAUDE.md'), /docs\/TOOLTIP-RULES\.md/);
  assert.match(await read('AGENTS.md'), /docs\/TOOLTIP-RULES\.md/);
});
