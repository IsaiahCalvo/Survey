// Nightly 'help-menu' (Drawboard Projects parity AE-12 / 17 / 19 / 20).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HELP_LINKS, SITE_ORIGIN, START_STEPS, helpLinkUrl, versionLine } from '../src/help/helpSupport.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('help links point at pages the marketing site builds', () => {
  const site = read('scripts/build-marketing.mjs');
  assert.match(site, new RegExp(`export const ORIGIN = '${SITE_ORIGIN.replace(/\./g, '\\.')}'`));
  for (const link of HELP_LINKS) {
    assert.match(site, new RegExp(`path: '${link.path}'`), link.path);
    assert.equal(helpLinkUrl(link), `${SITE_ORIGIN}${link.path}`);
  }
  assert.equal(helpLinkUrl({ path: '/faq' }, 'https://example.test/'), 'https://example.test/faq');
});

test('the start guide is short and the version line skips unknowns', () => {
  assert.ok(START_STEPS.length >= 3 && START_STEPS.length <= 6);
  assert.equal(versionLine({ version: '1.2.3', build: 'abc' }), 'Survey 1.2.3, build abc');
  assert.equal(versionLine({ version: 'unknown', build: 'unknown' }), 'Survey');
  assert.equal(versionLine(), 'Survey');
});

test('the flag is beta, the account menu uses it, the dialog sits on the shell, a migration adds the row', () => {
  assert.equal(FEATURE_FLAGS['help-menu'].stage, 'beta');
  const hub = read('src/home/HubShell.jsx');
  assert.match(hub, /isFeatureOn\('help-menu'\)/);
  assert.match(hub, /<HelpSupportDialog /);
  const dialog = read('src/help/HelpSupportDialog.jsx');
  assert.match(dialog, /import DialogCard from '\.\.\/components\/DialogCard\.jsx';/);
  assert.match(dialog, /target="_blank" rel="noopener noreferrer"/);
  assert.match(read('supabase/migrations/20261115214100_help_menu_flag.sql'), /'help-menu', 'off'/);
});
