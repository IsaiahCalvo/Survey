import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';

const appSource = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const viewerSource = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const adoptionModalSource = await readFile(new URL('../src/components/DocumentLegacyAdoptionArchiveModal.jsx', import.meta.url), 'utf8');
const preloadSource = await readFile(new URL('../src/preload.js', import.meta.url), 'utf8');
const mainSource = await readFile(new URL('../src/electron-main.js', import.meta.url), 'utf8');
const appTree = parse(appSource, { sourceType:'module',plugins:['jsx'] });
const id = value => `bc000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

function findNode(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

function recoverHandler(ports) {
  const node = findNode(appTree, candidate => candidate.type === 'VariableDeclarator'
    && candidate.id?.name === 'handleRecoverLegacySidecar');
  assert.ok(node);
  const callback = node.init.arguments[0];
  const source = appSource.slice(callback.start, callback.end)
    .replaceAll('import.meta.env.VITE_SUPABASE_URL', "'https://example.test'")
    .replaceAll('import.meta.env.VITE_SUPABASE_ANON_KEY', "'anon-key'");
  return Function(...Object.keys(ports), `return (${source});`)(...Object.values(ports));
}

test('recovery route is owner-only and rejects a late account or document change', async () => {
  const actor = id(1), documentId = id(2), generation = id(3), tabId = 'tab-1';
  const file = { id:documentId }, scope = { actorUserId:actor };
  const checkedBundle = { documentId,pdfGenerationId:generation,document:{ user_id:actor },
    legacy_sidecar_migration:{ version:1,state:'archived',source_generation_id:id(4) } };
  const tab = { id:tabId,file,checkedBundle,documentOpenScope:scope };
  const closeViewRef = { current:{ activeTabId:tabId,tabs:[tab] } };
  const documentOpenScopeRef = { current:scope };
  let resolveDownload;
  const download = new Promise(resolve => { resolveDownload = resolve; });
  const handler = recoverHandler({
    useCallback: callback => callback,
    user:{ id:actor }, closeViewRef, documentOpenScopeRef, supabase:{},
    createDocumentLegacySidecarRecovery: () => ({ download:() => download }),
  });
  const pending = handler({ tabId,file,checkedBundle,scope,signal:new AbortController().signal });
  documentOpenScopeRef.current = { actorUserId:id(9) };
  resolveDownload({ version:1,actorUserId:actor,documentId,pdfGenerationId:generation,
    blob:new Blob(['{}'], { type:'application/json' }) });
  await assert.rejects(pending, /document or account changed/i);

  documentOpenScopeRef.current = scope;
  const collaboratorBundle = { ...checkedBundle,document:{ user_id:id(8) } };
  await assert.rejects(handler({ tabId,file,checkedBundle:collaboratorBundle,scope }),
    /not available for the current document owner/i);
});

test('legacy-origin route uses status before an exact PDF or optional JSON export', async () => {
  const actor = id(11), documentId = id(12), generation = id(13), operation = id(14);
  const tabId = 'tab-adopted', file = { id:documentId }, scope = { actorUserId:actor };
  const checkedBundle = { documentId,pdfGenerationId:generation,document:{ user_id:actor },
    legacy_sidecar_migration:{ version:2,state:'archived',
      origin:{ mode:'legacy',adoption_operation_id:operation } } };
  const tab = { id:tabId,file,checkedBundle,documentOpenScope:scope };
  const calls = [];
  const status = { version:2,actorUserId:actor,documentId,pdfGenerationId:generation,
    adoptionOperationId:operation,objects:[{ kind:'pdf' }] };
  const handler = recoverHandler({ useCallback:callback => callback,user:{ id:actor },
    closeViewRef:{ current:{ activeTabId:tabId,tabs:[tab] } },
    documentOpenScopeRef:{ current:scope },supabase:{},
    createDocumentLegacySidecarRecovery:() => assert.fail('v2 must not use sidecar-only recovery'),
    createDocumentLegacyAdoptionArchiveRecovery:() => ({
      status:async input => { calls.push(['status',input]); return status; },
      download:async input => { calls.push(['download',input]); return { ...status,kind:input.kind,
        blob:new Blob(['%PDF'], { type:'application/pdf' }) }; },
    }),
  });
  assert.equal(await handler({ tabId,file,checkedBundle,scope,action:'status' }), status);
  const downloaded = await handler({ tabId,file,checkedBundle,scope,action:'download',kind:'pdf',
    adoptionOperationId:operation });
  assert.equal(downloaded.kind, 'pdf');
  assert.deepEqual(calls.map(entry => entry[0]), ['status','download']);
});

test('File menu uses the in-app warning gate and exports raw JSON without import', () => {
  assert.match(mainSource, /label: 'Export legacy sidecar archive…'[\s\S]*?send\('menu:recover-legacy-sidecar'\)/);
  assert.match(preloadSource, /onRecoverLegacySidecarMenu:[\s\S]*?ipcRenderer\.on\('menu:recover-legacy-sidecar'/);
  assert.match(viewerSource, /onRecoverLegacySidecarMenu\(\(\) => \{[\s\S]*?requestLegacySidecarRecovery\(\)/);
  assert.match(viewerSource, /recoverLegacySidecar: canRecoverLegacySidecar \? requestLegacySidecarRecovery : null/);
  assert.match(appSource, /aria-label="Export legacy sidecar archive"/,
    'the web app exposes the same recovery gate without Electron');
  assert.match(viewerSource, /title="Export legacy sidecar archive\?"/);
  assert.match(viewerSource, /open=\{legacySidecarRecoveryModalScope === legacySidecarRecoveryKey[\s\S]*?canRecoverLegacySidecar && isActive && checkedLegacySidecarArchived\}/);
  assert.match(viewerSource, /may contain old private view or tool settings/);
  assert.match(viewerSource, /does not load, adopt, share, or change the open document/);
  assert.match(viewerSource, /onRecoverLegacySidecar\(\{ action:'status'/);
  assert.match(adoptionModalSource, /Export original PDF/);
  assert.match(adoptionModalSource, /Export old JSON/);
  assert.match(adoptionModalSource, /const hasSidecar = status\.objects\?\.some\(entry => entry\.kind === 'sidecar'\)/);
  assert.match(adoptionModalSource, /\{hasSidecar && <button[\s\S]*?Export old JSON/,
    'a PDF-only v2 archive must not expose a JSON export control');
  assert.match(viewerSource, /await onRecoverLegacySidecar\([\s\S]*?api\.saveFile\(/);
  assert.match(viewerSource, /kind === 'pdf' \? \[\{ name: 'PDF files'[\s\S]*?JSON files/);
  assert.doesNotMatch(viewerSource, /onRecoverLegacySidecar[\s\S]{0,500}(?:adopt|uploadDataFile|saveSurveyDataToSupabase)\(/);
});
