/* No-account visitor walk, Nov 17: a refresh no longer brings the sign-in
   card back, a file kept on this device shows its real first page and when it
   was last opened, and the parts that need an account (Team, review, the
   people face on the phone) stay out of its way. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { createDeviceFiles } from '../src/services/deviceFiles.js';
import { canResolveThumbnailBytes } from '../src/home/thumbnailRequestPolicy.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const pdf = (n) => { const b = new Uint8Array(n); b.set([0x25, 0x50, 0x44, 0x46]); return b; };

test('opening a device file stamps last opened, not last edited', async () => {
  let t = 1000;
  const store = createDeviceFiles({ indexedDb: new IDBFactory(), now: () => (t += 10) });
  const row = await store.add({ name: 'a.pdf', bytes: pdf(10) });
  assert.equal(row.last_opened_at ?? null, null);
  assert.equal(await store.markOpened(row.id), true);
  const [listed] = await store.list();
  assert.equal(listed.updated_at, row.updated_at);
  assert.ok(Date.parse(listed.last_opened_at) > Date.parse(row.updated_at));
  assert.equal(await store.markOpened('cloud-uuid'), false);
});

test('the open paths stamp it, and the list reads it', () => {
  const actions = read('../src/home/deviceFileActions.js');
  assert.equal((actions.match(/deviceFiles\(\)\.markOpened\?\.\(/g) || []).length, 2);
  assert.match(read('../src/home/DocumentsLedger.jsx'), /openedMs: homeExtras\.openedByDoc\.get\(d\.id\) \|\| \(d\.device_file && Date\.parse\(d\.last_opened_at \|\| ''\)\) \|\| 0,/);
});

test('a device file draws its own first page, never the made-up sketch', () => {
  assert.equal(canResolveThumbnailBytes({ id: 'device-1', device_file: true }), true);
  const thumb = read('../src/home/PdfPageThumb.jsx');
  assert.match(thumb, /if \(doc\.device_file && isDeviceDocumentId\(doc\.id\)\) \{\s*const stored = await deviceFiles\(\)\.read\(doc\.id\);/);
});

test('"Continue without an account" holds for the tab, so a refresh does not ask again', () => {
  const src = read('../src/components/OptionalAuthPrompt.jsx');
  const hook = src.slice(src.indexOf('export const useOptionalAuth'));
  assert.match(hook, /useState\(visitorChoseNoAccount\)/);
  assert.match(hook, /!showAuthModal && !visitorChoseNoAccount\(\)\) \{/);
  assert.match(hook, /\} else \{\s*rememberVisitorChoice\(\);\s*\}/);
  assert.match(src, /globalThis\.sessionStorage\?\.setItem\(VISITOR_KEY, '1'\)/);
});

test('no Team, review or people face for a file kept on this device', () => {
  const ledger = read('../src/home/DocumentsLedger.jsx');
  assert.match(ledger, /\{!previewDoc\.raw\?\.device_file && \(\s*<div style=\{\{ marginTop: 14, flex: 'none' \}\}>\s*<div className="section-label">Team<\/div>/);
  assert.match(ledger, /\{reviewOn && !previewDoc\.raw\?\.device_file && \(/);
  assert.match(ledger, /\{reviewOn && !mobileDetailDoc\.raw\?\.device_file && \(/);
  const phone = read('../src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(phone, /\{!isDeviceDocumentId\(leftRailApi\?\.documentId\) && \(\s*<RailButton\s+label=\{`\$\{presenceCount\} active user/);
});
