import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FALLBACK_NAME,
  OPEN_FILE_EVENT,
  base64ToBytes,
  isOpenedFileUrl,
  looksLikePdf,
  openedFileName,
  receiveOpenedFile,
  resetOpenedFilesForTest,
  takeOpenedFiles,
} from '../src/mobile/nativeOpenFile.js';

const PDF_B64 = Buffer.from('%PDF-1.4\n%fake\n').toString('base64');

function fakeWin() {
  const events = [];
  return { events, dispatchEvent: (e) => events.push(e.type) };
}

test('only file and content urls count as opened files', () => {
  assert.equal(isOpenedFileUrl('file:///var/mobile/Documents/Inbox/A-101.pdf'), true);
  assert.equal(isOpenedFileUrl('content://com.android.providers.downloads.documents/document/12'), true);
  assert.equal(isOpenedFileUrl('https://surveytool.app/invite/abc'), false);
  assert.equal(isOpenedFileUrl('com.kalvoe.survey://sheet-connected?code=x'), false);
  assert.equal(isOpenedFileUrl(null), false);
});

test('file names come from the url, with a fallback for bare ids', () => {
  assert.equal(openedFileName('file:///private/var/Documents/Inbox/A-101%20Floor%20plan.pdf'), 'A-101 Floor plan.pdf');
  assert.equal(openedFileName('content://com.android.externalstorage.documents/document/primary%3ADownload%2FE-201.pdf'), 'E-201.pdf');
  assert.equal(openedFileName('content://com.google.android.gm.sapi/me/message_attachment_external/1/2'), FALLBACK_NAME);
  assert.equal(openedFileName('not a url'), FALLBACK_NAME);
  const long = `file:///x/${'a'.repeat(300)}.pdf`;
  assert.ok(openedFileName(long).length <= 200);
  assert.match(openedFileName(long), /\.pdf$/);
});

test('bytes are checked for the PDF header', () => {
  assert.equal(looksLikePdf(base64ToBytes(PDF_B64)), true);
  assert.equal(looksLikePdf(new TextEncoder().encode('junk\n%PDF-1.7')), true);
  assert.equal(looksLikePdf(new TextEncoder().encode('<html>')), false);
  assert.equal(looksLikePdf(new Uint8Array()), false);
});

test('a read PDF is parked as a File, once, and the iOS inbox copy is deleted', async () => {
  resetOpenedFilesForTest();
  const win = fakeWin();
  const deleted = [];
  const Filesystem = {
    readFile: async ({ path }) => { assert.match(path, /^file:/); return { data: PDF_B64 }; },
    deleteFile: async ({ path }) => { deleted.push(path); },
  };
  const url = 'file:///var/mobile/Documents/Inbox/A-101.pdf';
  assert.equal(await receiveOpenedFile(url, { Filesystem, win }), true);
  assert.equal(await receiveOpenedFile(url, { Filesystem, win }), false, 'the launch url and the event do not both upload it');
  assert.deepEqual(win.events, [OPEN_FILE_EVENT]);
  const [entry] = takeOpenedFiles();
  assert.equal(entry.file.name, 'A-101.pdf');
  assert.equal(entry.file.type, 'application/pdf');
  assert.deepEqual(deleted, [url]);
  assert.deepEqual(takeOpenedFiles(), []);
});

test('a non-PDF or an unreadable file is parked as a plain message', async () => {
  resetOpenedFilesForTest();
  const win = fakeWin();
  const notPdf = { readFile: async () => ({ data: Buffer.from('hello').toString('base64') }), deleteFile: async () => {} };
  await receiveOpenedFile('content://x/document/9', { Filesystem: notPdf, win });
  const broken = { readFile: async () => { throw new Error('denied'); }, deleteFile: async () => {} };
  await receiveOpenedFile('content://x/document/10', { Filesystem: broken, win });
  const entries = takeOpenedFiles();
  assert.deepEqual(entries.map((e) => e.error), [
    'That file is not a PDF.',
    'Survey could not read that file. Try again from Upload.',
  ]);
});

test('the deep link handler sends file urls to the reader before anything else', () => {
  const src = readFileSync(new URL('../src/mobile/nativeDeepLinks.js', import.meta.url), 'utf8');
  assert.match(src, /getLaunchUrl/);
  assert.match(src, /if \(openFile\(url\)\) return;/);
  assert.match(src, /import\('@capacitor\/filesystem'\)/);
});

// Beta flags never turn on in the stable phone apps, so a PDF handler there
// would list Survey under "Open with" only to refuse the file (Bugbot on
// #1381, bundle 1 audit 2026-11-10). The apps register for PDFs exactly when
// 'open-in-survey' has left beta.
test('the phone apps register for PDFs only once open-in-survey leaves beta', () => {
  const flags = readFileSync(new URL('../src/featureFlags.js', import.meta.url), 'utf8');
  const block = flags.slice(flags.indexOf("'open-in-survey': Object.freeze({"));
  const stage = /stage: '(\w+)'/.exec(block)?.[1];
  assert.ok(stage, 'open-in-survey has a stage');
  const strip = (text) => text.replace(/<!--[\s\S]*?-->/g, '');
  const manifest = strip(readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8'));
  const plist = strip(readFileSync(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8'));
  const android = /<data android:scheme="content" \/>\s*<data android:scheme="file" \/>\s*<data android:mimeType="application\/pdf" \/>/.test(manifest);
  const ios = /<key>CFBundleDocumentTypes<\/key>[\s\S]*com\.adobe\.pdf/.test(plist);
  assert.equal(android, stage !== 'beta', `Android PDF handler while the flag is ${stage}`);
  assert.equal(ios, stage !== 'beta', `iOS PDF document type while the flag is ${stage}`);
  if (ios) assert.match(plist, /<key>LSSupportsOpeningDocumentsInPlace<\/key>\s*<false\/>/);
});

test('with the flag off an opened file is neither read nor deleted', async () => {
  resetOpenedFilesForTest();
  const win = fakeWin();
  const calls = [];
  const Filesystem = { readFile: async () => { calls.push('read'); return { data: PDF_B64 }; }, deleteFile: async () => { calls.push('delete'); } };
  assert.equal(await receiveOpenedFile('file:///var/mobile/Documents/Inbox/Off.pdf', { Filesystem, win, enabled: false }), true);
  assert.deepEqual(calls, []);
  assert.deepEqual(takeOpenedFiles(), [{ disabled: true }]);
});

test('the deep link handler passes the open-in-survey flag to the reader', () => {
  const src = readFileSync(new URL('../src/mobile/nativeDeepLinks.js', import.meta.url), 'utf8');
  assert.match(src, /receiveOpenedFile\(url, \{ Filesystem, win, enabled: isFeatureOn\('open-in-survey'\) \}\)/);
});

test('the same Inbox url opened again later is a new open, not a repeat', async (t) => {
  resetOpenedFilesForTest();
  const win = fakeWin();
  const Filesystem = { readFile: async () => ({ data: PDF_B64 }), deleteFile: async () => {} };
  const url = 'file:///var/mobile/Documents/Inbox/A-101.pdf';
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  assert.equal(await receiveOpenedFile(url, { Filesystem, win }), true);
  now += 1000;
  assert.equal(await receiveOpenedFile(url, { Filesystem, win }), false);
  now += 10_000;
  assert.equal(await receiveOpenedFile(url, { Filesystem, win }), true);
  assert.equal(takeOpenedFiles().length, 2);
});
