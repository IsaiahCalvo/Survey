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

test('the phone apps register for PDFs', () => {
  const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(manifest, /<data android:scheme="content" \/>\s*<data android:scheme="file" \/>\s*<data android:mimeType="application\/pdf" \/>/);
  const plist = readFileSync(new URL('../ios/App/App/Info.plist', import.meta.url), 'utf8');
  assert.match(plist, /<key>CFBundleDocumentTypes<\/key>[\s\S]*com\.adobe\.pdf/);
  assert.match(plist, /<key>LSSupportsOpeningDocumentsInPlace<\/key>\s*<false\/>/);
});
