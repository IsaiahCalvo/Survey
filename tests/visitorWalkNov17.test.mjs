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

test('a signed-in tester at the project limit hears it before the dialog, and errors show inside it', () => {
  const dash = read('../src/Dashboard.jsx');
  assert.match(dash, /const handleCreateProjectClick = \(\) => \{[\s\S]{0,260}const projectCheck = canCreateProject\(\);\s*if \(!projectCheck\.allowed\) \{\s*setDashboardError\(projectCheck\.reason\);\s*return;/);
  assert.match(dash, /error=\{isProjectModalOpen \? dashboardError : ''\}/);
  assert.match(dash, /\{dashboardError && !isProjectModalOpen && \(/);
  assert.match(read('../src/home/CreateProjectModal.jsx'), /\{error \? \(\s*<p role="alert"/);
  const limits = read('../src/hooks/useSubscriptionLimits.js');
  assert.doesNotMatch(limits, /tier\.`/);
  assert.match(limits, /project\$\{limits\.projects > 1 \? 's' : ''\} on the \$\{planName\(userTier\)\} plan\./);
});

test('in the light look a page thumbnail keeps a hairline edge on the white panel', () => {
  const css = read('../src/styles.css');
  assert.match(css, /html\[data-look="suite"\]\[data-theme="light"\] :is\(\.pages-panel-preview, \.mobile-page-preview\) \{[\s\S]{0,140}box-shadow: 0 0 0 1px rgba\(0, 0, 0, 0\.12\)/);
});

test('the Documents list header lines its labels up and keeps the File sorts out of Project', () => {
  const ledger = read('../src/home/DocumentsLedger.jsx');
  const head = ledger.slice(ledger.indexOf('const ledgerHeader = {'), ledger.indexOf('};', ledger.indexOf('const ledgerHeader = {')));
  assert.match(head, /alignItems: 'center'/);
  assert.match(ledger, /gap: 12, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden' \}\}>/);
  assert.match(ledger, /\{key === 'sheet' \? 'Sheet' : label\}\{arrow\(key\)\}/);
});

test('signed out, the sample drawing is kept on this device first; a try-out only when it cannot be', () => {
  const dash = read('../src/Dashboard.jsx');
  const keep = dash.indexOf('if (!user && deviceFilesOn()) {');
  const tryOut = dash.indexOf("if (!user && sample && isFeatureOn('guest-sample')) {");
  assert.ok(keep > 0 && tryOut > keep);
});

test('a file kept on this device asks the server nothing about comments, people or review', () => {
  const comments = read('../src/services/markComments.js');
  assert.equal((comments.match(/if \(!documentId \|\| isDeviceDocumentId\(documentId\)\) return \[\];/g) || []).length, 2);
  const ledger = read('../src/home/DocumentsLedger.jsx');
  assert.match(ledger, /if \(!teamDocId \|\| teamDocRaw\?\.device_file\) return undefined;/);
  assert.match(ledger, /teamOwnerIsMe \|\| !supabase \|\| teamDocRaw\?\.device_file\) return undefined;/);
});
