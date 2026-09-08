import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
const componentPath = new URL('../src/components/collab/LegacyYDocRecoveryNotice.jsx', import.meta.url);
const source = await readFile(componentPath, 'utf8');
const present = documentId => ({ documentId, kind: 'probe', contentRead: false, state: 'present', hasReadFailure: false,
  registry: { state: 'present' }, indexedDB: { state: 'absent' } });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function mount(t, overrides = {}, initialProps = {}) {
  const calls = { probe: [], archiveProbe: [], archiveList: [], inspect: [], build: [], reports: [], downloads: [], urls: [], revoked: [] };
  const services = {
    probeLegacyRecoveryArchives: async (...args) => { calls.archiveProbe.push(args); return overrides.archiveProbe ? overrides.archiveProbe(...args) : { state: 'absent', count: 0 }; },
    listLegacyRecoveryArchives: async (...args) => { calls.archiveList.push(args); return overrides.archiveList ? overrides.archiveList(...args) : { state: 'absent', records: [] }; },
    probeLegacyYDocRecovery: async (...args) => { calls.probe.push(args); return overrides.probe ? overrides.probe(...args) : present(args[0]); },
    inspectLegacyYDocRecovery: async (...args) => { calls.inspect.push(args); return overrides.inspect ? overrides.inspect(...args) : { ...present(args[0]), secret: 'private-source-content' }; },
    buildLegacyYDocRecoveryExport: async (...args) => { calls.build.push(args); return overrides.build ? overrides.build(...args) : { format: 'survey-legacy-ydoc-recovery', version: 1 }; },
  };
  const key = `__legacyRecoveryNoticeTest_${crypto.randomUUID().replaceAll('-', '')}`;
  globalThis[key] = services;
  const executableSource = source
    .replace("from 'react'", `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`)
    .replace(/import \{ probeLegacyYDocRecovery, inspectLegacyYDocRecovery, buildLegacyYDocRecoveryExport \} from '[^']+';/,
      `const { probeLegacyYDocRecovery, inspectLegacyYDocRecovery, buildLegacyYDocRecoveryExport } = globalThis[${JSON.stringify(key)}];`)
    .replace(/import \{ probeLegacyRecoveryArchives, listLegacyRecoveryArchives \} from '[^']+';/,
      `const { probeLegacyRecoveryArchives, listLegacyRecoveryArchives } = globalThis[${JSON.stringify(key)}];`);
  const transformed = await transformWithOxc(executableSource, componentPath.pathname, { lang: 'jsx' });
  const code = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  const Notice = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  delete globalThis[key];
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const restores = [];
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restores.push(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  t.mock.method(URL, 'createObjectURL', blob => { const url = `blob:recovery-${calls.urls.length}`; calls.urls.push({ url, blob }); return url; });
  t.mock.method(URL, 'revokeObjectURL', url => calls.revoked.push(url));
  t.mock.method(dom.window.HTMLAnchorElement.prototype, 'click', function () { calls.downloads.push({ href: this.href, name: this.download }); });
  const host = document.getElementById('root');
  const root = createRoot(host);
  let unmounted = false;
  let props = { documentId: 'doc-a', onState: probe => calls.reports.push(probe), ...initialProps };
  const render = async next => { props = { ...props, ...next }; await act(async () => root.render(React.createElement(Notice, props))); };
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => root.unmount()); } };
  t.after(async () => { await unmount(); dom.window.close(); restores.reverse().forEach(restore => restore()); });
  await render();
  const click = async label => {
    const button = [...host.querySelectorAll('button')].find(button => button.textContent === label);
    assert.ok(button, `missing button ${label}`);
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  };
  return { calls, host, render, unmount, click };
}

test('mount probes only metadata and full recovery reads require an explicit export click', async t => {
  const h = await mount(t);
  assert.equal(h.calls.probe.length, 1);
  assert.equal(h.calls.probe[0][1].signal.aborted, false);
  assert.equal(h.calls.inspect.length, 0);
  assert.equal(h.calls.build.length, 0);
  assert.deepEqual(h.calls.reports, [{ ...present('doc-a'), archives: { state: 'absent', count: 0 } }]);
  assert.equal(h.calls.archiveProbe.length, 1);
  assert.equal(h.calls.archiveList.length, 0);
  assert.match(h.host.textContent, /owner is unknown/);
  await h.click('Export older local copy');
  assert.equal(h.calls.inspect.length, 1);
  assert.equal(h.calls.build.length, 1);
  assert.strictEqual(h.calls.inspect[0][1].signal, h.calls.build[0][1].signal);
  assert.equal(h.calls.build[0][0].recoveryReport.isSyncReceipt, false);
  assert.equal(h.calls.downloads.length, 1);
  assert.match(h.calls.downloads[0].name, /doc-a\.json$/);
  assert.equal(h.calls.reports.length, 1, 'export never reports a save receipt or ownership change');
  assert.doesNotMatch(h.host.textContent, /private-source-content/);
  assert.match(h.host.textContent, /does not mark this document synced or safe to close/);
  await h.unmount();
  assert.deepEqual(h.calls.revoked, h.calls.urls.map(item => item.url));
});

test('a cold archived copy is visible and included only after explicit export', async t => {
  const records = [{ id: 'archive-a', exportJson: '{"private":"retained"}' }];
  const h = await mount(t, {
    probe: async id => ({ ...present(id), state: 'absent', registry: { state: 'absent' } }),
    archiveProbe: async () => ({ state: 'present', count: 1 }),
    archiveList: async () => ({ state: 'present', records }),
  });
  assert.match(h.host.textContent, /older local copy/i);
  assert.equal(h.calls.archiveList.length, 0);
  await h.click('Export older local copy');
  assert.deepEqual(h.calls.build[0][0].archives.records, records);
  assert.equal(h.calls.build[0][0].recoveryReport.partial, false);
  assert.equal(h.calls.downloads.length, 1);
  assert.doesNotMatch(h.host.textContent, /retained/);
});

test('unreadable archives yield an explicit partial export, not a complete backup', async t => {
  const h = await mount(t, { archiveList: async () => { throw new Error('private storage detail'); } });
  await h.click('Export older local copy');
  assert.equal(h.calls.build[0][0].recoveryReport.partial, true);
  assert.equal(h.calls.build[0][0].recoveryReport.sourceStates.archives, 'read-failed');
  assert.match(h.calls.downloads[0].name, /partial/);
  assert.doesNotMatch(h.host.textContent, /private storage detail/);
});

test('absent and inactive sources remain hidden without full reads', async t => {
  const h = await mount(t, { probe: async id => ({ ...present(id), state: 'absent' }) }, { isActive: false });
  assert.equal(h.calls.probe.length, 0);
  assert.equal(h.host.textContent, '');
  await h.render({ isActive: true });
  assert.equal(h.calls.probe.length, 1);
  assert.equal(h.host.textContent, '');
  assert.equal(h.calls.inspect.length, 0);
});

test('partial source export is explicitly labeled in the file and UI', async t => {
  const h = await mount(t, { inspect: async id => ({ ...present(id), indexedDB: { state: 'read-failed', error: { message: 'private error detail' } } }) });
  await h.click('Export older local copy');
  assert.equal(h.calls.build[0][0].recoveryReport.partial, true);
  assert.match(h.calls.downloads[0].name, /-partial\.json$/);
  assert.match(h.host.textContent, /not a complete backup/);
  assert.doesNotMatch(h.host.textContent, /private error detail/);
});

for (const [kind, error, expected] of [
  ['limit', Object.assign(new Error('private count'), { code: 'LEGACY_RECOVERY_LIMIT' }), /safe size limit/],
  ['unsupported', new Error('Unsupported recovery export object: PrivateType'), /unsupported format/],
  ['read', new Error('private storage details'), /could not be made/],
]) {
  test(`${kind} failure never starts a download or claims a backup`, async t => {
    const h = await mount(t, { build: async () => { throw error; } });
    await h.click('Export older local copy');
    assert.match(h.host.textContent, expected);
    assert.match(h.host.textContent, /No recovery file was downloaded/);
    assert.doesNotMatch(h.host.textContent, /PrivateType|private count|private storage details/);
    assert.equal(h.calls.downloads.length, 0);
    assert.equal(h.calls.reports.length, 1);
  });
}

test('cancel aborts an in-progress read and ignores its late result', async t => {
  const read = deferred();
  const h = await mount(t, { inspect: () => read.promise });
  await h.click('Export older local copy');
  assert.equal(h.host.querySelector('button').disabled, true);
  await h.click('Cancel export');
  assert.equal(h.calls.inspect[0][1].signal.aborted, true);
  assert.match(h.host.textContent, /Export cancelled/);
  await act(async () => read.resolve(present('doc-a')));
  assert.equal(h.calls.build.length, 0);
  assert.equal(h.calls.downloads.length, 0);
});

test('document switch aborts pending probe and ignores its stale callback', async t => {
  const probe = deferred();
  const h = await mount(t, { probe: id => id === 'doc-a' ? probe.promise : present(id) });
  await h.render({ documentId: 'doc-b' });
  assert.equal(h.calls.probe[0][1].signal.aborted, true);
  await act(async () => probe.resolve(present('doc-a')));
  assert.deepEqual(h.calls.reports.map(probe => probe.documentId), ['doc-b']);
});

test('unmount aborts export encoding and ignores completion without leaking URLs', async t => {
  const build = deferred();
  const h = await mount(t, { build: () => build.promise });
  await h.click('Export older local copy');
  await h.unmount();
  assert.equal(h.calls.build[0][1].signal.aborted, true);
  await act(async () => build.resolve({ format: 'old' }));
  assert.equal(h.calls.urls.length, 0);
  assert.equal(h.calls.downloads.length, 0);
});

test('late encoding from a prior document cannot download or clear a newer export', async t => {
  const oldBuild = deferred();
  const newBuild = deferred();
  const h = await mount(t, { build: bundle => bundle.documentId === 'doc-a' ? oldBuild.promise : newBuild.promise });
  await h.click('Export older local copy');
  await h.render({ documentId: 'doc-b' });
  assert.equal(h.calls.build[0][1].signal.aborted, true);
  await h.click('Export older local copy');
  await act(async () => oldBuild.resolve({ format: 'old-document' }));
  assert.equal(h.calls.downloads.length, 0);
  assert.equal(h.host.querySelector('button').disabled, true);
  assert.match(h.host.textContent, /Cancel export/);
  await act(async () => newBuild.resolve({ format: 'new-document' }));
  assert.equal(h.calls.downloads.length, 1);
  assert.match(h.calls.downloads[0].name, /doc-b\.json$/);
});

test('probe failure reports only metadata failure and keeps recovery available', async t => {
  const h = await mount(t, { probe: async () => { throw new Error('private database detail'); } });
  assert.match(h.host.textContent, /could not be checked/);
  assert.doesNotMatch(h.host.textContent, /private database detail/);
  assert.equal(h.calls.reports[0].hasReadFailure, true);
  assert.equal(h.calls.reports[0].contentRead, false);
  assert.equal(h.calls.inspect.length, 0);
});
