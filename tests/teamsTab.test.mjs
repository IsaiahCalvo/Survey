// Survey as a Microsoft Teams tab: src/teams/teamsHost.js, the /teams header
// rule in vercel.json and the app package (teams-app/, scripts/build-teams-app.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { isTeamsTab, isTeamsConfig, startTeamsTab, connectTeamsConfig } from '../src/teams/teamsHost.js';
import { pinnedTabConfig, pinChoiceValid, pinTabName } from '../src/teams/teamsPin.js';
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
  assert.equal(isTeamsTab(frameWin('/teams/config')), true);
  assert.equal(isTeamsConfig(frameWin('/teams/config')), true);
  assert.equal(isTeamsConfig(frameWin('/teams/config', false)), false);
  assert.equal(isTeamsConfig(frameWin('/teams')), false);
  assert.equal(isTeamsTab(frameWin('/teams/other')), false);
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
  assert.deepEqual(nightly.staticTabs[0].scopes, ['personal']);
  assert.equal(nightly.configurableTabs[0].configurationUrl, 'https://surveytool-nightly.vercel.app/teams/config');
  assert.deepEqual(nightly.configurableTabs[0].scopes, ['team', 'groupChat']);
  assert.equal(nightly.configurableTabs[0].canUpdateConfiguration, true);
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

const P = '0b7a3c1e-2d4f-4a6b-8c9d-0e1f2a3b4c5d';
const D = '1c8b4d2f-3e5a-4b7c-9d0e-1f2a3b4c5d6e';

test('a pinned tab opens one project list or one drawing', () => {
  assert.equal(pinChoiceValid(null), false);
  assert.equal(pinChoiceValid({ projectId: 'x' }), false);
  assert.equal(pinChoiceValid({ projectId: P, docId: 'nope' }), false);
  const issues = pinnedTabConfig('https://surveytool-nightly.vercel.app/teams/config?x=1', { projectId: P, projectName: 'Tower A', list: 'issue' });
  assert.deepEqual(issues, {
    entityId: `survey-${P}-issue`,
    contentUrl: `https://surveytool-nightly.vercel.app/teams?project=${P}&list=issue`,
    websiteUrl: `https://surveytool-nightly.vercel.app/?project=${P}&list=issue`,
    suggestedDisplayName: 'Tower A issues',
  });
  const doc = pinnedTabConfig('https://surveytool.app', { projectId: P, projectName: 'Tower A', list: 'task', docId: D, docName: 'A-101 Level 1' });
  assert.equal(doc.contentUrl, `https://surveytool.app/teams?project=${P}&doc=${D}`);
  assert.equal(doc.suggestedDisplayName, 'A-101 Level 1');
  assert.equal(pinTabName({ projectId: P, projectName: 'Tower A', list: 'bogus' }), 'Tower A');
  assert.throws(() => pinnedTabConfig('https://surveytool.app', { projectId: 'x' }), /Pick a project/);
});

test('the setup page tells Teams when Save may be pressed and what it saves', async () => {
  const calls = [];
  let onSave = null;
  const pages = { config: {
    registerOnSaveHandler: (fn) => { onSave = fn; },
    setValidityState: (v) => calls.push(['valid', v]),
    setConfig: async (c) => { calls.push(['save', c.contentUrl]); },
  } };
  const app = { initialize: async () => {}, notifySuccess() {}, getContext: async () => ({ app: { theme: 'default' } }) };
  await startTeamsTab({ win: frameWin('/teams/config'), load: async () => ({ app, pages }) });
  const link = await connectTeamsConfig();
  assert.deepEqual(calls, [['valid', false]]);
  const failed = [];
  onSave({ notifySuccess() {}, notifyFailure: (m) => failed.push(m) });
  assert.deepEqual(failed, ['Pick a project first']);
  const config = pinnedTabConfig('https://surveytool.app', { projectId: P, projectName: 'Tower A' });
  link.setChoice(config);
  const done = await new Promise((resolve) => onSave({ notifySuccess: () => resolve('ok'), notifyFailure: resolve }));
  assert.equal(done, 'ok');
  assert.deepEqual(calls.slice(1), [['valid', true], ['save', `https://surveytool.app/teams?project=${P}&list=files`]]);
});

test('the app reads a pinned tab address back', async () => {
  const { readItemLink, withoutItemLink } = await import('../src/projectItems/itemLink.js');
  assert.deepEqual(readItemLink(`https://surveytool.app/teams?project=${P}&list=photos`), { projectId: P, itemId: null, kind: null, list: 'photos', docId: null });
  assert.deepEqual(readItemLink(`https://surveytool.app/teams?project=${P}&doc=${D}`), { projectId: P, itemId: null, kind: null, list: 'files', docId: D });
  assert.equal(readItemLink(`https://surveytool.app/teams?project=${P}&list=nope`).list, 'files');
  assert.equal(readItemLink(`https://surveytool.app/teams?project=${P}&doc=bad`), null);
  assert.equal(withoutItemLink(`https://surveytool.app/teams?project=${P}&doc=${D}&x=1`), '/teams?x=1');
});
