// Settings, Subscription tab polish (KAL-652, batch 16).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const jsx = readFileSync(new URL('../src/components/AccountSettings.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/components/AccountSettings.css', import.meta.url), 'utf8');
const usage = readFileSync(new URL('../src/components/UsageIndicator.jsx', import.meta.url), 'utf8');

test('Current plan is a quiet status with a tick, not a coral button look', () => {
  assert.equal((jsx.match(/account-plan-mark">\s*<Icon name="check"[^>]*\/>\s*Current plan/g) || []).length, 3);
  const rule = css.match(/\.account-plan-mark\.account-plan-mark \{([^}]*)\}/);
  assert.ok(rule, 'a doubled-class rule beats the outline classes');
  assert.match(rule[1], /background: transparent/);
  assert.match(rule[1], /color: var\(--text-2\)/);
});

test('Recommended is a pill, not coral words in brackets', () => {
  assert.ok(!jsx.includes('(Recommended)'));
  assert.match(css, /\.account-plan-badge-text \{[^}]*background: var\(--accent-soft\)/);
});

test('the Free nudge names the limit that set it off', async () => {
  const src = usage.match(/export const freeNudgeTitle = [\s\S]*?\n\};\n/)[0].replace('export ', '');
  const freeNudgeTitle = new Function(`${src}; return freeNudgeTitle;`)();
  assert.equal(freeNudgeTitle({ storagePercentage: 0, projectsPercentage: 100, documentsPercentage: 40 }), "You've used all your free projects");
  assert.equal(freeNudgeTitle({ storagePercentage: 0, projectsPercentage: 0, documentsPercentage: 80 }), "You're close to your free documents limit");
  assert.equal(freeNudgeTitle({ storagePercentage: 85, projectsPercentage: 0, documentsPercentage: 40 }), 'Running low on space');
  assert.equal(freeNudgeTitle({ storagePercentage: 100, projectsPercentage: 100, documentsPercentage: 0 }), 'Your storage is full');
  assert.ok(!/>\s*Running low on space\?/.test(usage), 'the old fixed heading is gone');
});
