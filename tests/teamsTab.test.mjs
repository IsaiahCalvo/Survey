// Survey as a Microsoft Teams tab: src/teams/teamsHost.js, the /teams header
// rule in vercel.json and the app package (teams-app/, scripts/build-teams-app.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { isTeamsTab, startTeamsTab } from '../src/teams/teamsHost.js';
import { buildTeamsApp, teamsManifest } from '../scripts/build-teams-app.mjs';

const frameWin = (pathname, framed = true) => {
  const win = { location: { pathname }, document: { documentElement: { dataset: {} } } };
  win.self = win;
  win.top = framed ? {} : win;
  return win;
};

test('only /teams inside a frame counts as the Teams tab', () => {
  assert.equal(isTeamsTab(frameWin('/teams')), true);
  assert.equal(isTeamsTab(frameWin('/teams/')), true);
  assert.equal(isTeamsTab(frameWin('/teams', false)), false);
  assert.equal(isTeamsTab(frameWin('/')), false);
  assert.equal(isTeamsTab(frameWin('/teamsx')), false);
  assert.equal(isTeamsTab({}), false);
});

test('the tab says hello, then ready, and keeps the Teams theme', async () => {
  const calls = [];
  const app = {
    initialize: async () => { calls.push('initialize'); },
    notifySuccess: () => { calls.push('success'); },
    getContext: async () => ({ app: { theme: 'contrast', locale: 'en-us', host: { name: 'Teams' } } }),
  };
  const win = frameWin('/teams');
  const out = await startTeamsTab({ win, load: async () => ({ app }) });
  assert.deepEqual(calls, ['initialize', 'success']);
  assert.deepEqual(out, { theme: 'contrast', locale: 'en-us', hostName: 'Teams' });
  assert.equal(win.document.documentElement.dataset.teamsTab, 'contrast');
});

test('outside Teams nothing loads; a silent host gives up', async () => {
  let loaded = false;
  assert.equal(await startTeamsTab({ win: frameWin('/teams', false), load: async () => { loaded = true; return {}; } }), null);
  assert.equal(loaded, false);
  const app = { initialize: () => new Promise(() => {}), notifySuccess() {}, getContext: async () => null };
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal(await startTeamsTab({ win: frameWin('/teams'), load: async () => ({ app }), timeoutMs: 20 }), null);
  } finally { console.warn = warn; }
});

const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const matching = (url) => vercel.headers.filter((r) => new RegExp(`^${r.source}$`).test(url));
const header = (rules, key) => rules.flatMap((r) => r.headers).filter((h) => h.key === key).map((h) => h.value);

test('only /teams may be framed, and only by Microsoft hosts', () => {
  for (const url of ['/teams', '/teams/']) {
    const rules = matching(url);
    assert.deepEqual(header(rules, 'X-Frame-Options'), [], `${url} has no DENY`);
    const csp = header(rules, 'Content-Security-Policy');
    assert.equal(csp.length, 1, `${url}: one policy`);
    const fa = csp[0].split(';').map((d) => d.trim()).find((d) => d.startsWith('frame-ancestors '));
    assert.equal(fa, 'frame-ancestors https://teams.microsoft.com https://*.teams.microsoft.com https://*.cloud.microsoft https://*.microsoft365.com https://*.office.com https://outlook.office.com https://outlook.office365.com');
  }
  for (const url of ['/', '/teamsx', '/flags', '/team', '/x/teams']) {
    const rules = matching(url);
    assert.deepEqual(header(rules, 'X-Frame-Options'), ['DENY'], `${url} keeps DENY`);
    assert.ok(header(rules, 'Content-Security-Policy').every((v) => v.includes("frame-ancestors 'none'")), `${url} stays unframeable`);
  }
});

test('the /teams policy is the app policy but for who may frame it and the Teams origin list', () => {
  const app = matching('/flags').flatMap((r) => r.headers).filter((h) => h.key === 'Content-Security-Policy').map((h) => h.value).find((v) => v.includes('script-src'));
  const teams = header(matching('/teams'), 'Content-Security-Policy')[0];
  const norm = (v) => v.split(';').map((d) => d.trim())
    .filter((d) => !d.startsWith('frame-ancestors '))
    .map((d) => d.replace(' https://res.cdn.office.net', ''));
  assert.deepEqual(norm(teams), norm(app));
  assert.match(teams, /connect-src [^;]*https:\/\/res\.cdn\.office\.net/);
});

test('the app package points at the right site and carries both icons', async () => {
  const nightly = teamsManifest('nightly');
  assert.equal(nightly.staticTabs[0].contentUrl, 'https://surveytool-nightly.vercel.app/teams');
  assert.equal(nightly.name.short, 'Survey Nightly');
  assert.deepEqual(nightly.staticTabs[0].scopes, ['personal', 'team', 'groupChat']);
  assert.ok(Number(nightly.manifestVersion) >= 1.16, 'static tabs in chats and channels need 1.16+');
  const stable = teamsManifest('stable');
  assert.equal(stable.staticTabs[0].contentUrl, 'https://surveytool.app/teams');
  for (const m of [nightly, stable]) {
    const host = new URL(m.staticTabs[0].contentUrl).hostname;
    assert.ok(m.validDomains.includes(host));
    assert.ok(!JSON.stringify(m).includes('{{'));
  }
  const zip = await JSZip.loadAsync(await buildTeamsApp('nightly'));
  assert.deepEqual(Object.keys(zip.files).sort(), ['color.png', 'manifest.json', 'outline.png']);
  assert.throws(() => teamsManifest('beta'), /Unknown channel/);
});
