// Nightly 'comment-pins': page pin rules (utils/pagePins.js), the row
// mapping (services/markComments.js) and the wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_PIN_FILTER,
  PIN_SIZE,
  isPinCycleKey,
  isPinDone,
  isPinShown,
  isPinToolKey,
  nextPinKind,
  normalizePinFilter,
  pagePointFromClient,
  pinCode,
  pinFilterAllOn,
  pinFromComment,
  pinPlacement,
  pinStatusColor,
  togglePinFilterMaster,
} from '../src/utils/pagePins.js';
import { mapCommentRow } from '../src/services/markComments.js';
import { resolveToolBarGroup } from '../src/utils/toolbarRows.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('M cycles Comment, Issue, Task and back', () => {
  assert.equal(nextPinKind('comment'), 'issue');
  assert.equal(nextPinKind('issue'), 'task');
  assert.equal(nextPinKind('task'), 'comment');
  assert.equal(nextPinKind('nonsense'), 'issue');
});

test('keys: plain N arms, plain M cycles; modifiers do not', () => {
  assert.equal(isPinToolKey({ code: 'KeyN' }), true);
  assert.equal(isPinToolKey({ code: 'KeyN', ctrlKey: true }), false);
  assert.equal(isPinCycleKey({ code: 'KeyM' }), true);
  assert.equal(isPinCycleKey({ code: 'KeyM', metaKey: true }), false);
});

test('status colours and done statuses follow Drawboard', () => {
  assert.equal(pinStatusColor('issue', 'draft'), '#919A9F');
  assert.equal(pinStatusColor('task', 'open'), '#558EFA');
  assert.equal(pinStatusColor('issue', 'closed'), '#666666');
  assert.equal(pinStatusColor('task', 'closed'), '#00AB65');
  assert.equal(pinStatusColor('issue', 'rejected'), '#E04758');
  assert.equal(pinStatusColor('task', 'on-hold'), '#9458F6');
  for (const s of ['closed', 'approved', 'rejected']) assert.equal(isPinDone({ kind: 'issue', status: s }), true);
  assert.equal(isPinDone({ kind: 'task', status: 'closed' }), true);
  assert.equal(isPinDone({ kind: 'task', status: 'in-review' }), false);
  assert.equal(isPinDone({ kind: 'comment', status: null }), false);
});

test('a comment row maps to a pin; replies and deleted rows do not', () => {
  const row = {
    id: 'a', document_id: 'd', thread_id: null, mark_id: null, page_number: 2, author_id: 'u', body: 'Leak',
    mentions: [], created_at: '2026-11-10T00:00:00Z', pin_x: 120.5, pin_y: 300, pin_kind: 'issue', pin_status: 'open', pin_number: 7,
  };
  const pin = pinFromComment(mapCommentRow(row));
  assert.deepEqual({ kind: pin.kind, status: pin.status, number: pin.number, page: pin.pageNumber, x: pin.x, y: pin.y }, { kind: 'issue', status: 'open', number: 7, page: 2, x: 120.5, y: 300 });
  assert.equal(pinCode(pin), 'ISS-7');
  assert.equal(pinCode({ kind: 'task', number: 1 }), 'TSK-1');
  assert.equal(pinCode({ kind: 'comment', number: null }), '');
  assert.equal(pinFromComment(mapCommentRow({ ...row, thread_id: 'x' })), null);
  assert.equal(pinFromComment(mapCommentRow({ ...row, deleted_at: '2026-11-10T01:00:00Z' })), null);
  assert.equal(pinFromComment(mapCommentRow({ ...row, pin_kind: null })), null);
  assert.equal(mapCommentRow({ ...row, pin_kind: null }).pin, null);
});

test('Show pins: master is on only with all three; a click flips all three; done hides', () => {
  const f = normalizePinFilter(null);
  assert.deepEqual(f, { ...DEFAULT_PIN_FILTER });
  assert.equal(pinFilterAllOn(f), true);
  const off = togglePinFilterMaster(f);
  assert.deepEqual([off.comments, off.issues, off.tasks], [false, false, false]);
  const one = { ...f, issues: false };
  assert.equal(pinFilterAllOn(one), false);
  assert.deepEqual(togglePinFilterMaster(one), { ...one, issues: true });
  const done = { id: 'i', kind: 'issue', status: 'closed' };
  assert.equal(isPinShown(done, f), false);
  assert.equal(isPinShown(done, { ...f, done: true }), true);
  assert.equal(isPinShown(done, f, { openId: 'i' }), true, 'an open card keeps its pin');
  assert.equal(isPinShown({ id: 'c', kind: 'comment' }, { ...f, comments: false }), false);
});

test('the pin corner goes on the pointer; placement is a share of the page', () => {
  const rect = { left: 100, top: 50, width: 612, height: 792 };
  assert.deepEqual(pagePointFromClient(rect, 400, 250, 612, 792), { x: 300, y: 200 });
  assert.deepEqual(pagePointFromClient({ ...rect, width: 1224, height: 1584 }, 700, 450, 612, 792), { x: 300, y: 200 });
  assert.deepEqual(pagePointFromClient(rect, 0, 0, 612, 792), { x: 0, y: 0 });
  assert.deepEqual(pinPlacement({ x: 306, y: 198 }, 612, 792), { left: '50%', top: '25%' });
  assert.equal(PIN_SIZE, 26);
});

test('the Pin tool and the Hyperlink tool keep the Text row on screen', () => {
  assert.equal(resolveToolBarGroup({ activeTool: 'pin' }), 'review');
  assert.equal(resolveToolBarGroup({ activeTool: 'hyperlink' }), 'review');
});

test('wiring: flag, migration, viewer host and layer, tool button, rail card, phone strip, keys sheet', () => {
  assert.match(read('src/featureFlags.js'), /'comment-pins': Object\.freeze\(\{[\s\S]*?stage: 'beta'/);
  const sql = read('supabase/migrations/20261110178000_comment_pins.sql');
  for (const bit of ['add_page_pin', 'update_page_pin', "('comment-pins', 'off'", 'pg_advisory_xact_lock', 'pin_kind, pin_status, pin_number']) {
    assert.ok(sql.includes(bit), bit);
  }
  // A status change must not move the pin (GREATEST skips a NULL).
  assert.match(sql, /CASE WHEN p_x IS NULL THEN pin_x ELSE GREATEST\(0, p_x\) END/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /<PagePinsHost[\s\S]*?documentId=\{pdfFile\?\.id \|\| null\}/);
  assert.match(viewer, /<PagePinsLayer[\s\S]*?pageNumber=\{pageNumber\}/);
  assert.match(viewer, /<PinToolButton/);
  assert.match(read('src/AppShell.jsx'), /<PinFilterMenu/);
  const phone = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(phone, /\{ id: 'pin', label: 'Pin', icon: 'pagePin', flag: 'comment-pins', cloudOnly: true \}/);
  assert.match(phone, /\(!tool\.cloudOnly \|\| bottomToolbarApi\?\.pinsAvailable\)/);
  // Pins save on a cloud document: no Pin tool on a device file or signed out.
  assert.match(viewer, /const pinsDocOn = pinsOn && Boolean\(pdfFile\?\.id\) && !isDeviceDocumentId\(pdfFile\?\.id\) && Boolean\(user\?\.id\);/);
  assert.match(viewer, /<PagePinsHost\s+enabled=\{pinsDocOn\}/);
  assert.match(viewer, /\{pinsDocOn && \(\s*<PagePinsLayer/);
  assert.match(viewer, /\.\.\.\(pinsDocOn \? \[\{ id: 'pin', label: 'Pin', pin: true \}\] : \[\]\)/);
  assert.match(viewer, /pinsAvailable: pinsDocOn,/);
  assert.match(read('src/utils/keyboardShortcuts.js'), /chords: \['n'\][^\n]*flag: 'comment-pins'/);
  const service = read('src/services/markComments.js');
  assert.match(service, /pin_x, pin_y, pin_kind, pin_status, pin_number'\)/);
  // Pan leaves pins to their own press.
  assert.match(read('src/components/pins/PagePinsLayer.jsx'), /data-pan-interactive="true"/);
});

test('the composer saves once and only with a status the pin kind takes (Bugbot on #1387)', () => {
  const src = readFileSync(new URL('../src/components/pins/PagePinsHost.jsx', import.meta.url), 'utf8');
  // A ref, not state, blocks the second submit before the next render.
  assert.match(src, /if \(busyRef\.current\) return false;\s*busyRef\.current = true;/);
  // A status from the previous kind falls back to the new kind's first one.
  assert.match(src, /const shownStatus = kindStatuses\.includes\(status\) \? status : \(kindStatuses\[0\] \|\| 'draft'\);/);
  assert.match(src, /status: kind === 'comment' \? null : shownStatus/);
  assert.match(src, /<StatusPill kind=\{kind\} status=\{shownStatus\}/);
});
