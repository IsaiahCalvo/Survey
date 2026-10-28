import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  addMarkComment,
  commentPieces,
  commentShareUrl,
  groupThreads,
  insertMention,
  listMarkComments,
  mapCommentRow,
  matchPeople,
  mentionQueryAt,
  mentionsInText,
  mergeComment,
  personLabel,
  takePendingMarkCommentsFocus,
  requestMarkCommentsFocus,
} from '../src/services/markComments.js';
import {
  MENTION_EMAIL_WINDOW_MS,
  commentExcerpt,
  commentLink,
  mentionEmailRefusal,
  mentionRecipients,
} from '../supabase/functions/_shared/commentMentions.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import { PANEL_IDS } from '../src/sidebar/panelLayoutStore.js';

const ANA = { id: '11111111-1111-4111-8111-111111111111', name: 'Ana Ruiz', email: 'ana@x.test' };
const BEN = { id: '22222222-2222-4222-8222-222222222222', name: null, email: 'ben.k@x.test' };
const c = (id, at, extra = {}) => mapCommentRow({ id, document_id: 'd', page_number: 2, created_at: at, body: id, ...extra });

test('threads: replies join their first comment, newest activity first, empty deleted roots dropped', () => {
  const rows = [
    c('a', '2026-10-27T10:00:00Z', { mark_id: 'rect-1' }),
    c('b', '2026-10-27T11:00:00Z'),
    c('a1', '2026-10-27T12:00:00Z', { thread_id: 'a' }),
    c('gone', '2026-10-27T13:00:00Z', { deleted_at: '2026-10-27T13:05:00Z', body: '' }),
  ];
  const threads = groupThreads(rows);
  assert.deepEqual(threads.map((t) => t.id), ['a', 'b']);
  assert.equal(threads[0].markId, 'rect-1');
  assert.deepEqual(threads[0].replies.map((r) => r.id), ['a1']);
  assert.equal(threads[0].lastAt, '2026-10-27T12:00:00Z');
});

test('mergeComment replaces by id and keeps time order', () => {
  let list = [c('a', '2026-10-27T10:00:00Z')];
  list = mergeComment(list, c('b', '2026-10-27T09:00:00Z'));
  assert.deepEqual(list.map((x) => x.id), ['b', 'a']);
  list = mergeComment(list, { ...list[1], body: 'changed' });
  assert.equal(list[1].body, 'changed');
  assert.equal(list.length, 2);
});

test('@mentions: find the word at the caret, offer people, insert and read back', () => {
  assert.equal(mentionQueryAt('hi there', 8), null);
  assert.deepEqual(mentionQueryAt('hi @an', 6), { start: 3, query: 'an' });
  assert.deepEqual(mentionQueryAt('@', 1), { start: 0, query: '' });
  assert.equal(mentionQueryAt('mail a@b', 8), null, 'an email address is not a mention');
  assert.deepEqual(matchPeople([ANA, BEN], 'ben').map((p) => p.id), [BEN.id]);
  assert.deepEqual(matchPeople([ANA, BEN], '').length, 2);
  assert.equal(personLabel(BEN), 'ben.k');
  assert.equal(personLabel(null), 'Former member');

  const { text, caret } = insertMention('hi @an', { start: 3, query: 'an' }, ANA);
  assert.equal(text, 'hi @Ana Ruiz ');
  assert.equal(caret, text.length);
  assert.deepEqual(mentionsInText(`${text}and @ben.k`, [ANA, BEN]), [ANA.id, BEN.id]);
  assert.deepEqual(mentionsInText('hi Ana', [ANA]), [], 'a removed @Name is no longer a mention');

  const people = new Map([[ANA.id, ANA]]);
  assert.deepEqual(commentPieces('see @Ana Ruiz now', [ANA.id], people), [
    { text: 'see ' }, { text: '@Ana Ruiz', mention: true }, { text: ' now' },
  ]);
  assert.deepEqual(commentPieces('plain', [], people), [{ text: 'plain' }]);
});

test('addMarkComment calls the checked server function', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { id: 'x', document_id: 'd', page_number: 3, created_at: 't', body: 'hi' }, error: null }; } };
  const saved = await addMarkComment(client, { documentId: 'd', pageNumber: 3, body: 'hi', markId: 'm', mentions: [ANA.id] });
  assert.equal(calls[0].name, 'add_mark_comment');
  assert.deepEqual(calls[0].args, { p_document_id: 'd', p_page_number: 3, p_body: 'hi', p_mark_id: 'm', p_thread_id: null, p_mentions: [ANA.id] });
  assert.equal(saved.pageNumber, 3);
  const failing = { rpc: async () => ({ data: null, error: { message: 'Document not found' } }) };
  await assert.rejects(addMarkComment(failing, { documentId: 'd', pageNumber: 1, body: 'x' }), /Document not found/);
});

test('a comment link waits for its document\'s rail', () => {
  requestMarkCommentsFocus({ documentId: 'doc-1', commentId: 'c-1' });
  assert.equal(takePendingMarkCommentsFocus('doc-2'), null);
  assert.deepEqual(takePendingMarkCommentsFocus('doc-1'), { documentId: 'doc-1', commentId: 'c-1' });
  assert.equal(takePendingMarkCommentsFocus('doc-1'), null, 'taken once');
});

test('mention email: only the author, once, soon after posting; never the author; link pinned to our sites', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  const fresh = { author_id: ANA.id, created_at: '2026-10-27T11:58:00Z', mentions: [BEN.id, ANA.id, BEN.id, 'nope'] };
  assert.equal(mentionEmailRefusal(fresh, ANA.id, now), null);
  assert.equal(mentionEmailRefusal(fresh, BEN.id, now), 'not-author');
  assert.equal(mentionEmailRefusal(null, ANA.id, now), 'not-found');
  assert.equal(mentionEmailRefusal({ ...fresh, mentions_notified_at: 'x' }, ANA.id, now), 'already-sent');
  assert.equal(mentionEmailRefusal({ ...fresh, deleted_at: 'x' }, ANA.id, now), 'deleted');
  assert.equal(mentionEmailRefusal({ ...fresh, created_at: new Date(now - MENTION_EMAIL_WINDOW_MS - 1000).toISOString() }, ANA.id, now), 'too-late');
  assert.deepEqual(mentionRecipients(fresh), [BEN.id]);
  assert.equal(commentExcerpt('a\n\n b', 280), 'a b');
  assert.equal(commentExcerpt('x'.repeat(300), 10), `${'x'.repeat(9)}…`);
  assert.equal(commentLink('https://surveytool-nightly.vercel.app', 'd1', 'c1'), 'https://surveytool-nightly.vercel.app/?docId=d1&comment=c1');
  assert.equal(commentLink('https://surveytool.app', 'd1', 'c1'), 'https://surveytool.app/?docId=d1&comment=c1');
  // Comments are Nightly-only: an unknown origin (desktop, phone app) gets Nightly.
  assert.equal(commentLink('https://evil.test', 'd1', 'c1'), 'https://surveytool-nightly.vercel.app/?docId=d1&comment=c1');
  assert.equal(commentLink('capacitor://localhost', 'd1', 'c1'), 'https://surveytool-nightly.vercel.app/?docId=d1&comment=c1');
});

test('comments are a beta flag with a server row, a rail panel id, and a mention function', () => {
  assert.equal(FEATURE_FLAGS['mark-comments']?.stage, 'beta');
  assert.ok(PANEL_IDS.includes('comments'));
  const sql = readFileSync(new URL('../supabase/migrations/20261028023000_mark_comments.sql', import.meta.url), 'utf8');
  assert.match(sql, /\('mark-comments', 'off'/);
  // Written only through the checked functions.
  assert.match(sql, /REVOKE ALL ON public\.mark_comments FROM PUBLIC, anon, authenticated;\s*GRANT SELECT ON public\.mark_comments TO authenticated;/);
  const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /\[functions\.notify-comment-mentions\]\s*verify_jwt = false/);
});

test('copied comment link: the page address on the web, Nightly from desktop or the phone app', () => {
  assert.equal(commentShareUrl({ origin: 'https://surveytool-nightly.vercel.app', pathname: '/' }, 'd1', 'c1'),
    'https://surveytool-nightly.vercel.app/?docId=d1&comment=c1');
  assert.equal(commentShareUrl({ origin: 'http://127.0.0.1:5199', pathname: '/' }, 'd1', 'c1'), 'http://127.0.0.1:5199/?docId=d1&comment=c1');
  for (const origin of ['null', 'file://', 'capacitor://localhost', undefined]) {
    assert.equal(commentShareUrl({ origin, pathname: '/Users/x/app/index.html' }, 'd1', 'c1'),
      'https://surveytool-nightly.vercel.app/?docId=d1&comment=c1');
  }
});

test('reading comments pages past the server row cap and keeps oldest first', async () => {
  const rows = Array.from({ length: 1203 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    document_id: 'd1', page_number: 1, body: `c${i}`,
    // ids and times run in opposite orders, so the result must be re-sorted.
    created_at: new Date(Date.parse('2026-10-28T00:00:00Z') - i * 1000).toISOString(),
  }));
  const calls = [];
  const client = {
    from() {
      const q = { gtId: null, size: Infinity };
      const api = {
        select: () => api, eq: () => api, order: () => api,
        limit: (n) => { q.size = n; return api; },
        gt: (_c, v) => { q.gtId = v; return api; },
        then: (resolve) => {
          calls.push(q.gtId);
          const batch = rows.filter((r) => q.gtId === null || r.id > q.gtId).slice(0, q.size);
          resolve({ data: batch, error: null });
        },
      };
      return api;
    },
  };
  const list = await listMarkComments(client, 'd1');
  assert.equal(list.length, 1203);
  assert.ok(calls.length >= 3);
  assert.equal(list[0].body, 'c1202');
  assert.equal(list.at(-1).body, 'c0');
});

test('a comment whose author account is gone fails closed: only the owner can delete it', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261028023000_mark_comments.sql', import.meta.url), 'utf8');
  const del = sql.slice(sql.indexOf('FUNCTION public.delete_mark_comment'));
  assert.match(del, /v_row\.author_id IS NOT DISTINCT FROM v_uid/);
  assert.doesNotMatch(del.slice(0, del.indexOf('END;')), /v_row\.author_id = v_uid/);
});
