import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { preparePdfUpload, readPdfPageCount, mapUploadsBounded } from '../src/home/pdfUploadWork.js';
import { resolveIncomingUpload } from '../src/utils/incomingFileResolver.js';

test('upload snapshot is owned before hashing and retains metadata before the read await', async () => {
  const source = new File(['original source bytes'], 'source.pdf', { type: 'application/pdf', lastModified: 1234 });
  source.user_id = 'actor-a';
  source.id = 'must-not-copy-cloud-identity';
  source.arrayBuffer = () => assert.fail('instance read override must not run');
  source.slice = () => assert.fail('instance slice override must not run');
  let release; let reads = 0; let hashInput;
  const pending = preparePdfUpload(source, {
    readBlobAsArrayBuffer: async blob => {
      reads++; assert.equal(blob instanceof Blob, true); assert.equal(blob instanceof File, false);
      await new Promise(resolve => { release = resolve; });
      return blob.arrayBuffer();
    },
    computeContentSha256: async bytes => {
      hashInput = new TextDecoder().decode(bytes);
      bytes.fill(0); // A retained/detached hashing buffer must not own uploaded bytes.
      await Promise.resolve(); return 'expected-hash';
    },
  });
  Object.defineProperties(source, { name: { value: 'later.pdf' }, lastModified: { value: 9999 } });
  source.user_id = 'actor-b';
  release();
  const prepared = await pending;
  assert.equal(reads, 1); assert.equal(hashInput, 'original source bytes');
  assert.notEqual(prepared.file, source);
  assert.equal(await prepared.file.text(), 'original source bytes');
  assert.equal(prepared.file.name, 'source.pdf'); assert.equal(prepared.file.lastModified, 1234);
  assert.equal(prepared.file.type, 'application/pdf'); assert.equal(prepared.file.user_id, 'actor-a');
  assert.equal(prepared.file.id, undefined); assert.equal(prepared.contentSha, 'expected-hash');
});

test('upload preparation preserves compatibility readers and does not introduce PDF header rejection', async () => {
  const file = new File(['not a parsed PDF'], 'legacy.pdf', { type: 'application/pdf' });
  const prepared = await preparePdfUpload(file, {
    readBlobAsArrayBuffer: blob => new Response(blob).arrayBuffer(),
    computeContentSha256: async bytes => `length-${bytes.length}`,
  });
  assert.equal(await prepared.file.text(), 'not a parsed PDF');
  assert.equal(prepared.contentSha, 'length-16');
  assert.equal(Object.hasOwn(prepared.file, 'user_id'), false);
});

test('upload preparation stops on read/size/hash failure without returning a usable upload', async () => {
  const file = new File(['source'], 'source.pdf'); let hashes = 0;
  for (const readBlobAsArrayBuffer of [async () => { throw new Error('read failed'); }, async () => new ArrayBuffer(1)]) {
    await assert.rejects(preparePdfUpload(file, { readBlobAsArrayBuffer, computeContentSha256: async () => { hashes++; } }));
  }
  assert.equal(hashes, 0);
  await assert.rejects(preparePdfUpload(file, { readBlobAsArrayBuffer: blob => blob.arrayBuffer(), computeContentSha256: async () => { throw new Error('hash failed'); } }), /hash failed/);
});

const dashboardSource = await readFile(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
const tick = () => new Promise(setImmediate);
function deferred() {
  let resolve; let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function singleUploadHarness(options = {}) {
  const calls = [];
  const state = { current: true, activeSection: options.activeSection || 'documents' };
  const original = new File(['old physical bytes'], 'picked.pdf', { type: 'application/pdf', lastModified: 1234 });
  const nativeBytes = new TextEncoder().encode('old physical bytes');
  const result = options.result || { document: { id: 'resolved', user_id: 'actor-a', project_id: null,
    name: 'published.pdf', file_path: 'actor-a/published.pdf' }, file: new Blob(['confirmed current bytes']), reused: !!options.reused };
  const cloud = { findDocumentsByName: async (...args) => {
    calls.push(['lookup', ...args]);
    if (options.lookup) return options.lookup(...args);
    return options.candidates || [];
  } };
  const current = () => state.current;
  const dependencies = {
    preparePdfUpload, resolveIncomingUpload, user: options.guest ? null : { id: 'actor-a' }, subscriptionTier: 'pro',
    activeSection: state.activeSection, selectedProjectId: options.selectedProjectId || null,
    uploadTargetProjectRef: { current: null }, singleUploadEntryRef: { current: null },
    singleUploadHandlerRef: { current: null }, fileInputRef: { current: { click: () => calls.push(['picker']) } },
    setSingleUploadWork: value => calls.push(['work', !!value]),
    readBlobAsArrayBuffer: async blob => {
      calls.push(['read', blob]);
      if (options.read) await options.read();
      return blob.arrayBuffer();
    },
    computeContentSha256: async bytes => {
      calls.push(['hash', new TextDecoder().decode(bytes)]);
      bytes.fill(0);
      nativeBytes.fill(0);
      original.arrayBuffer = () => assert.fail('mutable original must not be read');
      Object.defineProperty(original, 'name', { value: 'changed.pdf' });
      return 'old-hash';
    },
    supabase: {},
    createDocumentUploadCloud: async input => {
      calls.push(['cloud', input]);
      if (options.cloud) await options.cloud();
      return cloud;
    },
    documentUploadRecovery: { busy: !!options.busy, isCurrent: current, start: async input => {
      calls.push(['start', input]);
      if (options.start) return options.start(input);
      return result;
    } },
    askDuplicateUpload: async (...args) => {
      calls.push(['choice', ...args]);
      return options.choice ? options.choice() : 'new-version';
    },
    handleDocumentClick: async row => calls.push(['open-existing', row]),
    onActivateOpenDocument: row => { calls.push(['activate', row]); return !!options.alreadyOpen; },
    onDocumentSelect: (...args) => calls.push(['viewer', ...args]),
    setDashboardError: message => calls.push(['error', message]),
    showToast: message => calls.push(['toast', message]),
    onShowAuthModal: () => calls.push(['auth']),
    console: { error() {} },
    window: { electronAPI: options.native ? { openFile: async input => {
      calls.push(['native-picker', input]);
      if (options.picker) return options.picker();
      return { canceled: false, data: nativeBytes, fileName: 'picked.pdf', filePath: '/picked/current.pdf' };
    } } : undefined },
  };
  const gateStart = dashboardSource.indexOf('  const confirmSameNameDifferentContent = async');
  const gateEnd = dashboardSource.indexOf('  const navIconWrapperStyle =', gateStart);
  const start = dashboardSource.indexOf('  const uploadProjectId =');
  const end = dashboardSource.indexOf('  // Create Project flow', start);
  assert.ok(gateStart > 0 && gateEnd > gateStart && start > gateEnd && end > start);
  const handlers = Function(...Object.keys(dependencies),
    dashboardSource.slice(gateStart, gateEnd) + dashboardSource.slice(start, end) +
    '\nreturn { handleUploadClick, handleFileUpload, performSingleUpload };')(...Object.values(dependencies));
  const event = { target: { files: [original], value: 'selected' } };
  const run = async ({ projectId, open = true } = {}) => {
    await handlers.handleUploadClick(projectId, { open });
    if (!options.native) await handlers.handleFileUpload(event);
  };
  return { ...handlers, calls, state, original, event, run, dependencies, result };
}

for (const native of [false, true]) for (const reused of [false, true]) {
  test(`actual ${native ? 'Electron' : 'browser'} entry stages immutable bytes and opens only confirmed ${reused ? 'existing' : 'new'} bytes`, async () => {
    const gate = deferred();
    const h = singleUploadHarness({ native, reused, start: () => gate.promise });
    const pending = h.run();
    await tick();
    assert.equal(h.calls.filter(([kind]) => kind === 'start').length, 1);
    assert.equal(h.calls.some(([kind]) => kind === 'viewer' || kind === 'activate' || kind === 'open-existing'), false);
    const staged = h.calls.find(([kind]) => kind === 'start')[1];
    assert.equal(staged.file, staged.prepared.file);
    assert.notEqual(staged.file, h.original);
    assert.equal(await staged.file.text(), 'old physical bytes');
    assert.equal(staged.file.name, 'picked.pdf');
    assert.equal(staged.prepared.contentSha, 'old-hash');
    assert.equal(staged.projectId, null);
    assert.deepEqual(h.calls.filter(([kind]) => kind === 'hash').map(call => call[1]), ['old physical bytes']);
    assert.deepEqual(h.calls.find(([kind]) => kind === 'lookup'), ['lookup', null, 'picked.pdf']);
    gate.resolve(h.result); await pending;
    const opened = h.calls.find(([kind]) => kind === 'viewer');
    assert.equal(await opened[1].text(), 'confirmed current bytes');
    assert.equal(opened[1].name, 'published.pdf');
    assert.equal(opened[1].id, 'resolved');
    assert.equal(opened[1].user_id, 'actor-a');
    assert.equal(opened[1].supabaseFilePath, 'actor-a/published.pdf');
    assert.equal(opened[2], native && !reused ? '/picked/current.pdf' : undefined);
    assert.deepEqual(h.calls.at(-1), ['work', false]);
    if (!native) assert.equal(h.event.target.value, '');
  });
}

for (const phase of ['read', 'cloud', 'lookup', 'start']) {
  test(`account retirement during ${phase} stops later upload work and stale UI`, async () => {
    const gate = deferred();
    const h = singleUploadHarness({ [phase]: () => gate.promise });
    const pending = h.run(); await tick();
    h.state.current = false;
    const count = h.calls.length;
    gate.resolve(phase === 'lookup' ? [] : phase === 'start' ? h.result : undefined);
    await pending;
    assert.deepEqual(h.calls.slice(count).filter(([kind]) => kind !== 'hash'), [], 'local hashing may settle, but no later dispatch, open, error or stale busy reset');
    assert.equal(h.calls.some(([kind]) => kind === 'viewer'), false);
  });
}

test('a retired browser picker selection cannot enter the new account flow', async () => {
  const h = singleUploadHarness();
  await h.handleUploadClick('chosen-project');
  h.state.current = false;
  await h.handleFileUpload(h.event);
  assert.deepEqual(h.calls, [['picker']]);
  assert.equal(h.event.target.value, '');
});

test('native picker retirement and cancellation never start hashing or durable work', async () => {
  const gate = deferred(); const h = singleUploadHarness({ native: true, picker: () => gate.promise });
  const pending = h.run(); await tick(); h.state.current = false;
  const count = h.calls.length;
  gate.resolve({ canceled: false, data: new Uint8Array([1]), fileName: 'picked.pdf' });
  await pending; assert.equal(h.calls.length, count);
  const canceled = singleUploadHarness({ native: true, picker: async () => ({ canceled: true }) });
  await canceled.run();
  assert.equal(canceled.calls.some(([kind]) => kind === 'read' || kind === 'start'), false);
  assert.deepEqual(canceled.calls.at(-1), ['work', false]);
});

for (const saved of [false, true]) {
  test(`durable ${saved ? 'saved-attempt' : 'pre-stage'} failure never opens and shows a safe retry message`, async () => {
    const h = singleUploadHarness({ start: async () => { throw Object.assign(new Error('RAW_SECRET_SERVICE_ERROR'), saved ? { attemptId: 'saved' } : {}); } });
    await h.run();
    assert.equal(h.calls.some(([kind]) => kind === 'viewer' || kind === 'activate' || kind === 'open-existing'), false);
    const error = h.calls.find(([kind]) => kind === 'error')[1];
    assert.match(error, saved ? /saved retry copy/ : /Keep the original/);
    assert.equal(error.includes('RAW_SECRET'), false);
    assert.deepEqual(h.calls.at(-1), ['work', false]);
  });
}

test('allocated attempt ID with failed local staging tells the user to keep the original, not a saved retry copy', async () => {
  const h = singleUploadHarness({ start: async () => {
    throw Object.assign(new Error('Local storage full'), { attemptId: 'allocated', recoveryCreated: false });
  } });
  await h.run();
  const error = h.calls.find(([kind]) => kind === 'error')[1];
  assert.match(error, /Keep the original/);
  assert.doesNotMatch(error, /saved retry copy|File upload recovery/);
  assert.equal(h.calls.some(([kind]) => kind === 'viewer' || kind === 'activate' || kind === 'open-existing'), false);
  assert.deepEqual(h.calls.at(-1), ['work', false]);
});

test('duplicate replacement carries the chosen full snapshot into durable start without archiving directly', async () => {
  const selected = { id: 'old', user_id: 'actor-a', project_id: 'project', name: 'picked.pdf',
    file_path: 'actor-a/old.pdf', file_size: 5, content_sha256: 'different-hash', updated_at: 'before',
    archived: false, user_archived_at: null };
  const h = singleUploadHarness({ candidates: [selected] });
  await h.run({ projectId: 'project', open: false });
  const staged = h.calls.find(([kind]) => kind === 'start')[1];
  assert.deepEqual(staged.archiveDocument, selected);
  assert.equal(staged.projectId, 'project');
  assert.equal(h.calls.some(([kind]) => kind === 'viewer' || kind === 'activate'), false);
});

test('duplicate lookup failure cancels safely; cancellation and stale modal cannot stage a retry', async () => {
  const failed = singleUploadHarness({ lookup: async () => { throw new Error('offline'); } });
  await failed.run();
  assert.equal(failed.calls.some(([kind]) => kind === 'start'), false);
  assert.equal(failed.calls.filter(([kind]) => kind === 'toast').length, 1);
  const selected = { id: 'old', name: 'picked.pdf', project_id: null, content_sha256: 'different' };
  for (const choice of ['cancel', 'open-existing']) {
    const h = singleUploadHarness({ candidates: [selected], choice: async () => choice });
    await h.run();
    assert.equal(h.calls.some(([kind]) => kind === 'start' || kind === 'viewer'), false);
    assert.equal(h.calls.some(([kind]) => kind === 'open-existing'), choice === 'open-existing');
  }
  const gate = deferred(); const h = singleUploadHarness({ candidates: [selected], choice: () => gate.promise });
  const pending = h.run(); await tick(); h.state.current = false; const count = h.calls.length;
  gate.resolve('new-version'); await pending; assert.equal(h.calls.length, count);
});

test('shared entry lock rejects a second submit while the first upload is pending', async () => {
  const gate = deferred(); const h = singleUploadHarness({ start: () => gate.promise });
  const pending = h.handleFileUpload(h.event); await tick();
  await h.handleFileUpload({ target: { files: [new File(['second'], 'second.pdf', { type: 'application/pdf' })], value: 'second' } });
  assert.equal(h.calls.filter(([kind]) => kind === 'start').length, 1);
  gate.resolve(h.result); await pending;
});

test('already-open documents activate only after recovery confirms bytes; projects retain durable recovery', async () => {
  const h = singleUploadHarness({ alreadyOpen: true });
  await h.run();
  assert.equal(h.calls.filter(([kind]) => kind === 'activate').length, 1);
  assert.equal(h.calls.some(([kind]) => kind === 'viewer'), false);
  assert.ok(h.calls.findIndex(([kind]) => kind === 'start') < h.calls.findIndex(([kind]) => kind === 'activate'));
  assert.match(dashboardSource, /return projectUploadRecovery\.start\(trimmedName, files\)/);
  assert.doesNotMatch(dashboardSource, /deleteSupabaseProject\(newProject\.id\)/);
});

test('confirmed local retry discard clears its stale upload error only in the current account', async () => {
  const source = dashboardSource.slice(dashboardSource.indexOf('  const discardDocumentUpload ='), dashboardSource.indexOf('  // Same name + different'));
  for (const mode of ['success', 'cancel', 'retired', 'failed']) {
    let current = true; const calls = [];
    const recovery = { isCurrent: () => current, discard: async id => {
      calls.push(['discard', id]);
      if (mode === 'failed') throw new Error('local storage unavailable');
      if (mode === 'retired') current = false;
    } };
    const discard = new Function('documentUploadRecovery', 'user', 'askConfirm', 'setDashboardError',
      `${source}; return discardDocumentUpload;`)(recovery, { id: 'actor' }, async () => mode !== 'cancel', value => calls.push(['error', value]));
    await discard({ actorId: 'actor', id: 'attempt', name: 'picked.pdf' });
    assert.equal(calls.some(([kind]) => kind === 'error'), mode === 'success');
    assert.equal(calls.some(([kind]) => kind === 'discard'), mode !== 'cancel');
  }
});

function parser(failures = 0) {
  const events = [];
  let attempt = 0;
  return {
    events,
    adapters: {
      readBlobAsArrayBuffer: async () => new ArrayBuffer(4),
      loadPdfjs: async () => ({
        VerbosityLevel: { ERRORS: 0 },
        getDocument(options) {
          const current = attempt++;
          events.push(['load', current, options]);
          return {
            promise: current < failures ? Promise.reject(new Error(`parse-${current}`)) : Promise.resolve({ numPages: 8 }),
            destroy: async () => { events.push(['destroy', current]); },
          };
        },
      }),
    },
  };
}

test('page counts release the loading task after a successful parse', async () => {
  const fake = parser();
  assert.equal(await readPdfPageCount({}, fake.adapters), 8);
  assert.deepEqual(fake.events.map(event => event.slice(0, 2)), [['load', 0], ['destroy', 0]]);
});

test('failed first parse is destroyed before recovery starts with fresh bytes', async () => {
  const fake = parser(1);
  assert.equal(await readPdfPageCount({}, fake.adapters), 8);
  assert.deepEqual(fake.events.map(event => event.slice(0, 2)), [['load', 0], ['destroy', 0], ['load', 1], ['destroy', 1]]);
  const [first, second] = fake.events.filter(event => event[0] === 'load').map(event => event[2]);
  assert.notEqual(first.data, second.data);
  assert.equal(second.stopAtErrors, false);
});

test('both failed parses release resources and preserve the final parse error', async () => {
  const fake = parser(2);
  await assert.rejects(readPdfPageCount({}, fake.adapters), /parse-1/);
  assert.deepEqual(fake.events.map(event => event.slice(0, 2)), [['load', 0], ['destroy', 0], ['load', 1], ['destroy', 1]]);
});

test('batch workers never exceed three and preserve input order despite failures', async () => {
  let active = 0;
  let peak = 0;
  const entries = [0, 1, 2, 3, 4, 5, 6];
  const results = await mapUploadsBounded(entries, async entry => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, (7 - entry) % 3));
      if (entry === 2) throw new Error('upload failed');
      return { success: true, entry };
    } finally { active--; }
  });
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
  assert.deepEqual(results.map(result => result.value?.entry ?? null), [0, 1, null, 3, 4, 5, 6]);
  assert.match(results[2].reason.message, /upload failed/);
});

test('empty batches do not start workers', async () => {
  assert.deepEqual(await mapUploadsBounded([], () => { throw new Error('unexpected'); }), []);
});

test('real project handlers submit once, retire stale accounts, and retain failed durable attempts', async t => {
  const source = await readFile(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const persistProject = async');
  const end = source.indexOf('  // Legacy hub selection mode', start);
  assert.ok(start >= 0 && end > start);
  function harness({ failure = null, holdName = false } = {}) {
    const calls = [];
    let resolveName;
    const nameResult = holdName ? new Promise(resolve => { resolveName = resolve; }) : Promise.resolve([]);
    const current = { value: true };
    const scope = {};
    const dependencies = {
      isProjectCreateCurrent: () => current.value,
      user: { id: 'actor' }, canCreateProject: () => ({ allowed: true }),
      canUploadDocument: () => ({ allowed: true }),
      refetchProjects: () => { calls.push(['name-read']); return nameResult; },
      supabaseProjects: [], hasNameConflict: () => false,
      projectUploadRecovery: { busy: false, start: async (...args) => { calls.push(['start', ...args]); if (failure) throw failure; } },
      projectName: '  Project  ', projectFiles: [], projectCreateBusyRef: { current: null }, projectCreateScope: scope,
      setDashboardError: value => calls.push(['error', value]),
      setUploadInFlight: value => calls.push(['busy', value]),
      setIsProjectModalOpen: value => calls.push(['modal', value]),
      setProjectName: value => calls.push(['name', value]), setProjectFiles: value => calls.push(['files', value]),
      onShowAuthModal: () => calls.push(['auth']),
    };
    const handlers = Function(...Object.keys(dependencies), source.slice(start, end) + '\nreturn { persistProject, handleConfirmCreateProject };')(...Object.values(dependencies));
    return { ...handlers, calls, current, resolveName };
  }
  await t.test('two same-turn submits share one name check and one durable start, including zero files', async () => {
    const h = harness({ holdName: true });
    const first = h.handleConfirmCreateProject();
    await h.handleConfirmCreateProject();
    assert.equal(h.calls.filter(([event]) => event === 'name-read').length, 1);
    h.resolveName([]); await first;
    assert.deepEqual(h.calls.filter(([event]) => event === 'start'), [['start', 'Project', []]]);
    assert.deepEqual(h.calls.at(-1), ['busy', false]);
  });
  await t.test('an account change during name lookup cannot create a durable attempt or publish stale UI', async () => {
    const h = harness({ holdName: true });
    const pending = h.handleConfirmCreateProject();
    h.current.value = false;
    const before = h.calls.length;
    h.resolveName([]); await pending;
    assert.equal(h.calls.length, before);
    await h.handleConfirmCreateProject();
    assert.equal(h.calls.length, before);
  });
  for (const saved of [false, true]) await t.test(saved ? 'saved attempt closes modal and directs retry without raw cloud error' : 'pre-attempt failure keeps modal for retry without raw error', async () => {
    const failure = Object.assign(new Error('RAW_SECRET_SERVICE_ERROR'), saved ? { attemptId: 'attempt' } : {});
    const h = harness({ failure }); await h.handleConfirmCreateProject();
    assert.equal(h.calls.some(([event]) => event === 'modal'), saved);
    assert.equal(JSON.stringify(h.calls).includes('RAW_SECRET_SERVICE_ERROR'), false);
    if (saved) assert.match(h.calls.find(([event]) => event === 'error')[1], /recovery.*saved attempt/);
  });
  await t.test('known failed local staging keeps selected PDFs even if an ID was allocated', async () => {
    const failure = Object.assign(new Error('Local storage full'), { attemptId: 'allocated', recoveryCreated: false });
    const h = harness({ failure }); await h.handleConfirmCreateProject();
    assert.equal(h.calls.some(([event]) => event === 'modal' || event === 'files'), false);
  });
});
