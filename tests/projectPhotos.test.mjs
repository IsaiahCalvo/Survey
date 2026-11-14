// Projects Photos tab (flag project-photos): the pure rules in
// src/projectPhotos/projectPhotos.js and the database rules in
// supabase/migrations/20261114120000_project_photos.sql.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  photoPath, markedPhotoPath, shownPath, photoMimeAllowed, groupOf, groupPhotos, filterIsEmpty, withinRange,
  filterPhotos, EMPTY_FILTER, uploadedOn, photoFileName, strokeScale, arrowHead, markBounds, hitMark, moveMark,
} from '../src/projectPhotos/projectPhotos.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const P = 'AAAAAAAA-0000-4000-8000-000000000001';
const F = 'bbbbbbbb-0000-4000-8000-000000000002';
const p = 'aaaaaaaa-0000-4000-8000-000000000001';

test('photo paths: <project>/<photo>.<ext>, lower case, only jpeg/png/webp', () => {
  assert.equal(photoPath(P, F, 'image/jpeg'), `${p}/${F}.jpg`);
  assert.equal(photoPath(P, F, 'image/png'), `${p}/${F}.png`);
  assert.equal(photoPath(P, F, 'image/webp'), `${p}/${F}.webp`);
  assert.equal(photoPath(P, F, 'image/gif'), null);
  assert.equal(photoPath('nope', F, 'image/png'), null);
  assert.equal(photoMimeAllowed('image/heic'), false);
});

test('marked copies count up so a cached old markup never shows', () => {
  assert.equal(markedPhotoPath(P, F, null), `${p}/${F}-m1.png`);
  assert.equal(markedPhotoPath(P, F, `${p}/${F}-m1.png`), `${p}/${F}-m2.png`);
  assert.equal(markedPhotoPath(P, F, `${p}/${F}-m999999.png`), `${p}/${F}-m1.png`);
  assert.equal(shownPath({ path: 'a.jpg', marked_path: 'a-m1.png' }), 'a-m1.png');
  assert.equal(shownPath({ path: 'a.jpg', marked_path: null }), 'a.jpg');
});

test('day groups say Today and Yesterday; weeks start Monday; months name the month', () => {
  const now = new Date(2026, 10, 14, 12); // Sat Nov 14 2026
  assert.equal(groupOf(new Date(2026, 10, 14, 8), 'day', now).label, 'Today');
  assert.equal(groupOf(new Date(2026, 10, 13, 23), 'day', now).label, 'Yesterday');
  assert.equal(groupOf(new Date(2026, 10, 2), 'day', now).label, 'Nov 2');
  assert.equal(groupOf(new Date(2025, 10, 2), 'day', now).label, 'Nov 2, 2025');
  assert.equal(groupOf(new Date(2026, 10, 14), 'week', now).label, 'Week of Nov 9 – 15');
  assert.equal(groupOf(new Date(2026, 10, 30), 'week', now).label, 'Week of Nov 30 – Dec 6');
  assert.equal(groupOf(new Date(2026, 10, 30), 'month', now).label, 'November 2026');
  assert.equal(groupOf('junk', 'day', now).label, 'Unknown date');
});

test('groups and photos come newest first', () => {
  const now = new Date(2026, 10, 14, 12);
  const photos = [
    { id: 'a', created_at: new Date(2026, 10, 12, 9).toISOString() },
    { id: 'b', created_at: new Date(2026, 10, 14, 9).toISOString() },
    { id: 'c', created_at: new Date(2026, 10, 14, 10).toISOString() },
  ];
  const groups = groupPhotos(photos, 'day', now);
  assert.deepEqual(groups.map((g) => g.label), ['Today', 'Nov 12']);
  assert.deepEqual(groups[0].photos.map((x) => x.id), ['c', 'b']);
});

test('filters: mine, uploaders, linked / not linked, time windows', () => {
  const now = new Date(2026, 10, 14, 12); // Saturday
  const at = (d, h = 9) => new Date(2026, 10, d, h).toISOString();
  const photos = [
    { id: '1', uploaded_by: 'me', created_at: at(14) },
    { id: '2', uploaded_by: 'you', created_at: at(5) },
    { id: '3', uploaded_by: 'me', created_at: at(1) },
  ];
  const linkCounts = new Map([['2', 1]]);
  const run = (over) => filterPhotos(photos, { ...EMPTY_FILTER, ...over }, { userId: 'me', linkCounts, now }).map((x) => x.id);
  assert.equal(filterIsEmpty(EMPTY_FILTER), true);
  assert.deepEqual(run({}), ['1', '2', '3']);
  assert.deepEqual(run({ mine: true }), ['1', '3']);
  assert.deepEqual(run({ uploaders: ['you'] }), ['2']);
  assert.deepEqual(run({ linked: true }), ['2']);
  assert.deepEqual(run({ unlinked: true }), ['1', '3']);
  assert.deepEqual(run({ linked: true, unlinked: true }), ['1', '2', '3']);
  assert.deepEqual(run({ within: 'day' }), ['1']);
  assert.deepEqual(run({ within: 'week' }), ['2']); // Mon Nov 2 – Sun Nov 8
  assert.deepEqual(run({ within: 'range', from: '2026-11-01', to: '2026-11-05' }), ['2', '3']);
  assert.equal(withinRange({ within: 'range', from: '', to: '' }, now), null);
});

test('labels: uploaded-on line and safe download names', () => {
  assert.equal(uploadedOn(new Date(2026, 10, 10, 1, 10)), '11/10/2026 at 1:10 AM');
  assert.equal(uploadedOn(new Date(2026, 10, 10, 13, 5)), '11/10/2026 at 1:05 PM');
  const photo = { created_at: new Date(2026, 10, 10, 1, 10).toISOString(), path: 'x/y.jpg', marked_path: 'x/y-m2.png' };
  assert.equal(photoFileName('Site: A/B', photo), 'Site A B photo 2026-11-10 0110.png');
  assert.equal(photoFileName('', { ...photo, marked_path: null }, 2), 'Project photo 2026-11-10 0110 (3).jpg');
});

test('markup model: widths scale with the photo, hits pick the top mark, moves keep shape', () => {
  assert.equal(strokeScale(800, 600), 1);
  assert.equal(strokeScale(4000, 3000), 4);
  const head = arrowHead(0, 0, 100, 0, 4);
  assert.deepEqual(head[0], [100, 0]);
  assert.ok(head[1][0] < 100 && head[2][0] < 100);
  const pen = { kind: 'pen', width: 4, points: [[10, 10], [50, 50]] };
  const arrow = { kind: 'arrow', width: 4, x1: 20, y1: 20, x2: 40, y2: 40 };
  const text = { kind: 'text', x: 200, y: 200, size: 20, text: 'hi\nthere' };
  assert.deepEqual(markBounds(pen), { x: 2, y: 2, w: 56, h: 56 });
  assert.equal(markBounds(text).h, 50);
  assert.equal(hitMark([pen, arrow], 30, 30), 1);
  assert.equal(hitMark([pen, arrow], 5, 5), 0);
  assert.equal(hitMark([pen, arrow, text], 500, 500), -1);
  assert.deepEqual(moveMark(pen, 5, -5).points, [[15, 5], [55, 45]]);
  assert.deepEqual(moveMark(arrow, 1, 1), { ...arrow, x1: 21, y1: 21, x2: 41, y2: 41 });
  assert.deepEqual(moveMark(text, 1, 2), { ...text, x: 201, y: 202 });
});

test('flag is a Nightly beta flag and the database keeps its rules', () => {
  const flag = FEATURE_FLAGS['project-photos'];
  assert.ok(flag, 'project-photos flag');
  assert.equal(flag.stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261114120000_project_photos.sql', import.meta.url), 'utf8');
  assert.match(sql, /'project-photos',\s*'off'/);
  assert.match(sql, /bad photo path/);
  assert.match(sql, /bad marked path/);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /is_guest_session\(\)/);
  assert.match(sql, /is_agent_session\(\)/);
  assert.match(sql, /photo_added/);
  assert.match(sql, /account_deletion_storage_objects/);
});
