// Drag-and-drop PDF upload (owner request 2026-10-13): the pure rules behind
// the drop zones, plus the wiring that keeps drops on the one upload path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  addedToProjectMessage,
  asPdfFile,
  dropOverlayCopy,
  installStrayFileDropGuard,
  isFileDrag,
  isPdfFile,
  isPhoneLayout,
  isUploadableProjectId,
  nextDragDepth,
  rejectedFilesMessage,
  resolveProjectDropTarget,
  splitDroppedFiles,
} from '../src/utils/fileDrop.js';

const file = (name, type = '') => ({ name, type });
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('only drags carrying Files count (page thumbnails, dnd-kit rows, text never do)', () => {
  assert.equal(isFileDrag({ types: ['Files'] }), true);
  assert.equal(isFileDrag({ types: ['application/x-moz-file', 'Files'] }), true);
  assert.equal(isFileDrag({ types: ['application/pdf-page'] }), false);
  assert.equal(isFileDrag({ types: ['text/plain', 'text/html'] }), false);
  assert.equal(isFileDrag({ types: [] }), false);
  assert.equal(isFileDrag(null), false);
  // DOMStringList (older engines) only has contains().
  assert.equal(isFileDrag({ types: { contains: (t) => t === 'Files' } }), true);
});

test('a PDF is known by its type, or by its name when the OS gave none', () => {
  assert.equal(isPdfFile(file('a.pdf', 'application/pdf')), true);
  assert.equal(isPdfFile(file('A.PDF', '')), true);
  assert.equal(isPdfFile(file('a.pdf', 'application/octet-stream')), true);
  assert.equal(isPdfFile(file('photo.png', 'image/png')), false);
  assert.equal(isPdfFile(file('fake.pdf', 'image/png')), false);
  assert.equal(isPdfFile(file('notes.txt', '')), false);
  assert.equal(isPdfFile(null), false);
});

test('dropped files split into PDFs and the rest, order kept', () => {
  const a = file('a.pdf', 'application/pdf');
  const b = file('b.png', 'image/png');
  const c = file('c.pdf', '');
  assert.deepEqual(splitDroppedFiles([a, b, c]), { pdfs: [a, c], rejected: [b] });
  assert.deepEqual(splitDroppedFiles(null), { pdfs: [], rejected: [] });
});

test('a typeless PDF is re-wrapped with the PDF type (same name and bytes)', async () => {
  const raw = new File([new Uint8Array([37, 80, 68, 70])], 'Plan.pdf', { type: '' });
  const wrapped = asPdfFile(raw);
  assert.equal(wrapped.type, 'application/pdf');
  assert.equal(wrapped.name, 'Plan.pdf');
  assert.deepEqual([...new Uint8Array(await wrapped.arrayBuffer())], [37, 80, 68, 70]);
  const typed = new File([new Uint8Array([1])], 'x.pdf', { type: 'application/pdf' });
  assert.equal(asPdfFile(typed), typed);
});

test('non-PDF note is short and names the file when there is one', () => {
  assert.equal(rejectedFilesMessage([]), null);
  assert.equal(rejectedFilesMessage([file('photo.png')]), 'Only PDFs can be added. “photo.png” was skipped.');
  assert.equal(rejectedFilesMessage([file('a.png'), file('b.doc')]), 'Only PDFs can be added. 2 files were skipped.');
});

test('project success note counts PDFs', () => {
  assert.equal(addedToProjectMessage(0, 'Roof'), null);
  assert.equal(addedToProjectMessage(1, 'Roof'), 'Added 1 PDF to Roof');
  assert.equal(addedToProjectMessage(3, 'Roof'), 'Added 3 PDFs to Roof');
});

test('drag depth: children crossing does not end the drag; drop and leave-all do', () => {
  let d = 0;
  d = nextDragDepth(d, 'dragenter'); // zone
  d = nextDragDepth(d, 'dragenter'); // child
  d = nextDragDepth(d, 'dragleave'); // left zone for child
  assert.equal(d, 1);
  d = nextDragDepth(d, 'dragleave');
  assert.equal(d, 0);
  assert.equal(nextDragDepth(0, 'dragleave'), 0);
  assert.equal(nextDragDepth(5, 'drop'), 0);
  assert.equal(nextDragDepth(5, 'dragend'), 0);
  assert.equal(nextDragDepth(Number.NaN, 'dragenter'), 1);
});

test('projects: a row wins over the open project; unsaved projects take no files', () => {
  const projects = [{ id: 'p1', name: 'Roof' }, { id: 'p2', name: 'Lobby' }, { id: 'local-9', name: 'Draft' }];
  assert.deepEqual(
    resolveProjectDropTarget({ rowProjectId: 'p2', openProject: projects[0], projects }),
    { key: 'project:p2', kind: 'project-row', projectId: 'p2', projectName: 'Lobby' },
  );
  assert.deepEqual(
    resolveProjectDropTarget({ rowProjectId: null, openProject: projects[0], projects }),
    { key: 'open:p1', kind: 'project-open', projectId: 'p1', projectName: 'Roof' },
  );
  // Over an unsaved row: falls back to the open project.
  assert.equal(resolveProjectDropTarget({ rowProjectId: 'local-9', openProject: projects[0], projects }).projectId, 'p1');
  assert.equal(resolveProjectDropTarget({ rowProjectId: null, openProject: null, projects }), null);
  assert.equal(resolveProjectDropTarget({ openProject: projects[2], projects }), null);
  assert.equal(isUploadableProjectId('p1'), true);
  assert.equal(isUploadableProjectId('local-1'), false);
  assert.equal(isUploadableProjectId(null), false);
});

test('overlay words say what the drop will do', () => {
  assert.deepEqual(dropOverlayCopy({ kind: 'documents' }), { label: 'Drop PDFs to upload', hint: 'They’ll be added to Documents', accept: true });
  assert.equal(dropOverlayCopy({ kind: 'project-row', projectName: 'Roof' }).label, 'Drop to add to Roof');
  assert.equal(dropOverlayCopy({ kind: 'project-open', projectName: 'Lobby' }).label, 'Drop to add to Lobby');
  assert.equal(dropOverlayCopy({ kind: 'viewer' }).label, 'Drop PDFs to open');
  assert.equal(dropOverlayCopy(null).accept, false);
});

test('stray-drop guard refuses unclaimed file drags only, and is idempotent', () => {
  const listeners = {};
  const target = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type) => { delete listeners[type]; },
  };
  const uninstall = installStrayFileDropGuard(target);
  assert.equal(typeof listeners.dragover, 'function');
  assert.equal(typeof listeners.drop, 'function');
  // A second install is a no-op (it does not double up).
  const before = { ...listeners };
  installStrayFileDropGuard(target);
  assert.equal(listeners.dragover, before.dragover);

  const ev = (types, defaultPrevented = false) => {
    const e = { dataTransfer: { types, dropEffect: 'copy' }, defaultPrevented, prevented: false };
    e.preventDefault = () => { e.prevented = true; };
    return e;
  };
  const stray = ev(['Files']);
  listeners.dragover(stray);
  assert.equal(stray.prevented, true);
  assert.equal(stray.dataTransfer.dropEffect, 'none');
  const claimed = ev(['Files'], true);
  listeners.dragover(claimed);
  assert.equal(claimed.dataTransfer.dropEffect, 'copy', 'a zone that claimed the drag keeps its copy cursor');
  const internal = ev(['text/plain']);
  listeners.dragover(internal);
  listeners.drop(internal);
  assert.equal(internal.prevented, false, 'in-app drags are left alone');
  const drop = ev(['Files']);
  listeners.drop(drop);
  assert.equal(drop.prevented, true, 'a stray file drop never navigates');
  uninstall();
  assert.equal(listeners.dragover, undefined);
});

test('phone layout (the shared screen rule) takes no drops; desktop does', () => {
  const PHONE_Q = 'screen and (max-device-width: 599px), screen and (max-device-height: 599px)';
  const win = (w, h) => ({ screen: { width: w, height: h }, matchMedia: (q) => ({ matches: q === PHONE_Q && Math.min(w, h) < 600 }) });
  assert.equal(isPhoneLayout(win(390, 844)), true, 'iPhone upright');
  assert.equal(isPhoneLayout(win(844, 390)), true, 'iPhone sideways');
  assert.equal(isPhoneLayout(win(834, 1194)), false, 'iPad takes drops');
  assert.equal(isPhoneLayout(win(1440, 900)), false, 'desktop / touch laptop');
  assert.equal(isPhoneLayout(null), false);
  assert.match(read('src/hooks/useFileDropZone.js'), /isPhoneLayout\(\)\) return;/);
});

test('wiring: drops reuse the Upload button path, never a second one', () => {
  const dashboard = read('src/Dashboard.jsx');
  assert.match(dashboard, /const uploadBrowserPdf = async \(file, \{ projectId = null, openAfterUpload = true, waitForStorage = false, askDuplicates = true \} = \{\}\) =>/);
  assert.match(dashboard, /await uploadBrowserPdf\(file, \{ projectId, openAfterUpload \}\);/, 'the file picker goes through the shared path');
  assert.match(dashboard, /await uploadBrowserPdf\(asPdfFile\(pdf\), \{/, 'drops go through the same path');
  assert.match(dashboard, /uploadDroppedFiles: handleDroppedFiles/);
  assert.match(dashboard, /onDropFiles=\{handleDroppedFiles\}/);
  // The shared path still asks about duplicates and creates the row before opening.
  const core = dashboard.slice(dashboard.indexOf('const uploadBrowserPdf'), dashboard.indexOf('const handleFileUpload'));
  assert.match(core, /confirmSameNameDifferentContent\(/);
  assert.match(core, /createSupabaseDocument\(/);
  // Row first, at its own object <user>/<row id>.pdf (#812), then the bytes go there.
  assert.match(core, /file_path: ownDocumentObjectPath\(user\.id, newDocId\)/);
  assert.match(core, /uploadToStorage\(file, projectId \|\| 'general', undefined, contentSha, \{ objectPath: resolvedDoc\.file_path \}\)/);

  const appShell = read('src/AppShell.jsx');
  assert.match(appShell, /enabled: Boolean\(isViewerVisible && !isNarrowShell\)/, 'viewer drop is desktop only');
  assert.match(appShell, /uploadDroppedFiles\?\.\(files, \{ open: true \}\)/, 'a viewer drop opens new tabs');

  assert.match(read('src/main.jsx'), /installStrayFileDropGuard\(window\)/);
  assert.match(read('src/electron-main.js'), /parsedUrl\.protocol === 'file:'/);
  assert.match(read('src/home/DocumentsLedger.jsx'), /dropProps=\{dropProps\}/);
  assert.match(read('src/home/ProjectsFolderTree.jsx'), /resolveProjectDropTarget\(/);
});

test('wiring: PDF tools saves wait for the stored bytes and report failures', () => {
  const dashboard = read('src/Dashboard.jsx');
  assert.match(dashboard, /if \(waitForStorage && !\(await stored\)\) return 'failed';/);
  const save = dashboard.slice(dashboard.indexOf('const savePdfToolResults'), dashboard.indexOf('const cloneDocumentToProject'));
  assert.match(save, /uploadBrowserPdf\(file, \{ projectId: targetProjectId, openAfterUpload: false, waitForStorage: true, askDuplicates: false \}\)/);
  assert.match(save, /freeDocumentName\(result\.name, taken\)/, 'results get a free name, never the hidden duplicate ask');
  assert.match(save, /if \(notSaved\) throw new Error/);
});

test('wiring: PDF tools on an open document use the bytes in the tab, so they work offline', () => {
  const appShell = read('src/AppShell.jsx');
  assert.match(appShell, /let blob = file instanceof Blob && file\.size > 0 \? file : null;/);
  // A streamed open (#1097) has no File: the viewer's pdf.js document has the bytes.
  assert.match(appShell, /const data = await leftRailApi\?\.pdfDoc\?\.getData\?\.\(\);/);
  const dashboard = read('src/Dashboard.jsx');
  const source = dashboard.slice(dashboard.indexOf('const pdfToolSource'), dashboard.indexOf('const openPdfTools'));
  assert.match(source, /if \(doc\.blob\) return new Uint8Array\(await doc\.blob\.arrayBuffer\(\)\);/);
  assert.match(source, /navigator\?\.onLine === false/, 'offline gets its own message');
  assert.match(dashboard, /\.filter\(\(doc\) => doc\?\.file_path \|\| doc\?\.blob\)/);
});
