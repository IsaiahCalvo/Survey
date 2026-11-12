// src/services/markComments.js
//
// Comments on marks (Nightly, flag 'mark-comments'; migration
// 20261028050000_mark_comments.sql). Rows are read straight from the table
// (its select policy is the document's own access) and written only through
// the add / edit / delete functions. A thread is its first comment plus the
// replies that point at it; it hangs off one mark (markId) or a page.

import { readLibraryRows } from '../hooks/libraryPagination.js';

// The link-focus bits live apart so the app shell can load them without this
// whole service on first load.
export { OPEN_MARK_COMMENTS_EVENT, requestMarkCommentsFocus, takePendingMarkCommentsFocus } from './markCommentsFocus.js';

export const MARK_COMMENT_MAX_CHARS = 4000;
export const MARK_COMMENT_MAX_MENTIONS = 20;
// A copied link from a page with no web address of its own (desktop file://,
// the phone app) opens on surveytool.app: those apps run the stable build.
export const COMMENT_LINK_FALLBACK_ORIGIN = 'https://surveytool.app';

/** The link a person copies to open the document at this comment. */
export function commentShareUrl(location, documentId, commentId) {
  const origin = location?.origin;
  const web = typeof origin === 'string' && /^https?:\/\/[^/]+$/.test(origin)
    && (origin.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  const url = web
    ? new URL(origin + (location.pathname || '/'))
    : new URL(COMMENT_LINK_FALLBACK_ORIGIN + '/');
  url.searchParams.set('docId', documentId);
  url.searchParams.set('comment', commentId);
  return url.toString();
}

export function mapCommentRow(row) {
  return {
    id: row.id,
    documentId: row.document_id,
    threadId: row.thread_id || null,
    markId: row.mark_id || null,
    pageNumber: Number(row.page_number) || 1,
    authorId: row.author_id || null,
    body: row.body || '',
    mentions: Array.isArray(row.mentions) ? row.mentions : [],
    createdAt: row.created_at,
    editedAt: row.edited_at || null,
    deletedAt: row.deleted_at || null,
    // KAL-415: a thread start can be resolved (set_mark_comment_resolved).
    resolvedAt: row.resolved_at || null,
    resolvedBy: row.resolved_by || null,
    // Nightly 'comment-pins': a page thread with a spot on the page.
    pin: row.pin_kind ? {
      kind: row.pin_kind,
      x: Number(row.pin_x) || 0,
      y: Number(row.pin_y) || 0,
      status: row.pin_status || null,
      number: row.pin_number == null ? null : Number(row.pin_number),
    } : null,
  };
}

export async function listMarkComments(client, documentId) {
  if (!documentId) return [];
  // Page by id past PostgREST's row cap, then sort oldest first for display.
  const { data, error } = await readLibraryRows(() => client
    .from('mark_comments')
    .select('id, document_id, thread_id, mark_id, page_number, author_id, body, mentions, created_at, edited_at, deleted_at, pin_x, pin_y, pin_kind, pin_status, pin_number, resolved_at, resolved_by')
    .eq('document_id', documentId));
  if (error) throw new Error(error.message || 'Could not read the comments');
  return [...data]
    .sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || String(a.id).localeCompare(String(b.id)))
    .map(mapCommentRow);
}

export async function listCommentPeople(client, documentId) {
  if (!documentId) return [];
  const { data, error } = await client.rpc('mark_comment_people', { p_document_id: documentId });
  if (error) throw new Error(error.message || 'Could not read who is on this document');
  return (data || []).map((row) => ({ id: row.user_id, name: row.name || null, email: row.email || null, guest: row.guest === true }));
}

function rpcRow(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  return row ? mapCommentRow(row) : null;
}

export async function addMarkComment(client, { documentId, pageNumber, body, markId = null, threadId = null, mentions = [] }) {
  return rpcRow(await client.rpc('add_mark_comment', {
    p_document_id: documentId,
    p_page_number: pageNumber,
    p_body: body,
    p_mark_id: markId,
    p_thread_id: threadId,
    p_mentions: mentions,
  }), 'Could not post the comment');
}

/** Nightly 'comment-pins': drop a Comment, Issue or Task pin on a page. */
export async function addPagePin(client, { documentId, pageNumber, x, y, kind, body, status = null, mentions = [] }) {
  return rpcRow(await client.rpc('add_page_pin', {
    p_document_id: documentId,
    p_page_number: pageNumber,
    p_x: x,
    p_y: y,
    p_kind: kind,
    p_body: body,
    p_status: status,
    p_mentions: mentions,
  }), 'Could not save the pin');
}

/** Move a pin (page and spot) or set an issue / task status. */
export async function updatePagePin(client, { commentId, pageNumber = null, x = null, y = null, status = null }) {
  return rpcRow(await client.rpc('update_page_pin', {
    p_comment_id: commentId,
    p_page_number: pageNumber,
    p_x: x,
    p_y: y,
    p_status: status,
  }), 'Could not change the pin');
}

/** Resolve a thread (its first comment) or reopen it. */
export async function setMarkCommentResolved(client, { commentId, resolved }) {
  return rpcRow(await client.rpc('set_mark_comment_resolved', { p_comment_id: commentId, p_resolved: Boolean(resolved) }), resolved ? 'Could not resolve the thread' : 'Could not reopen the thread');
}

/** Split threads into the Open and Resolved lists (a thread is resolved when its first comment is). */
export function splitResolvedThreads(threads) {
  const open = [];
  const resolved = [];
  for (const t of threads || []) (t.root?.resolvedAt ? resolved : open).push(t);
  return { open, resolved };
}

export async function editMarkComment(client, { commentId, body, mentions = [] }) {
  return rpcRow(await client.rpc('edit_mark_comment', { p_comment_id: commentId, p_body: body, p_mentions: mentions }), 'Could not save the change');
}

export async function deleteMarkComment(client, commentId) {
  return rpcRow(await client.rpc('delete_mark_comment', { p_comment_id: commentId }), 'Could not delete the comment');
}

/**
 * "Upload as new version": copy the old copy's comment threads onto the new
 * one (carry_mark_comments). Resolves to how many comments came across; 0 on
 * a server without the function. Throws on any other error.
 */
export async function carryMarkComments(client, fromDocumentId, toDocumentId) {
  const { data, error } = await client.rpc('carry_mark_comments', { p_from_document_id: fromDocumentId, p_to_document_id: toDocumentId });
  if (error) {
    const code = String(error.code || '');
    if (code === 'PGRST202' || code === '42883') return 0;
    throw new Error(error.message || 'Could not bring the comments across');
  }
  return Number(data) || 0;
}

/** Ask the server to email the comment's @mentions. Never throws: a missed email must not lose the comment. */
export async function notifyCommentMentions(client, commentId, origin) {
  try {
    const { error } = await client.functions.invoke('notify-comment-mentions', { body: { commentId, origin } });
    if (error) console.warn('[comments] mention email not sent', error.message || error);
  } catch (err) {
    console.warn('[comments] mention email not sent', err?.message || err);
  }
}

/** Keep one copy of each comment, the newest seen (live changes arrive out of order). */
export function mergeComment(list, comment) {
  const index = list.findIndex((c) => c.id === comment.id);
  if (index < 0) return [...list, comment].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const next = list.slice();
  next[index] = comment;
  return next;
}

/** Threads newest activity first: { id, root, replies, markId, pageNumber, lastAt }. */
export function groupThreads(comments) {
  const roots = new Map();
  for (const c of comments || []) {
    if (!c.threadId) roots.set(c.id, { id: c.id, root: c, replies: [], markId: c.markId, pageNumber: c.pageNumber, lastAt: c.createdAt });
  }
  for (const c of comments || []) {
    if (!c.threadId) continue;
    const thread = roots.get(c.threadId);
    if (!thread) continue;
    thread.replies.push(c);
    if (String(c.createdAt) > String(thread.lastAt)) thread.lastAt = c.createdAt;
  }
  return [...roots.values()]
    // A deleted first comment with no replies has nothing left to show.
    .filter((t) => !t.root.deletedAt || t.replies.some((r) => !r.deletedAt))
    .sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
}

export function personLabel(person) {
  if (!person) return 'Former member';
  return person.name || (person.email ? person.email.split('@')[0] : 'Someone');
}

/**
 * The @word being typed at the caret, or null: { start, query } where start
 * is the index of the "@".
 */
export function mentionQueryAt(text, caret) {
  const before = String(text || '').slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,40})$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
}

// Guests (guest links) have no email to send a mention to, so they are not offered.
export function matchPeople(people, query, { exclude = [] } = {}) {
  const q = String(query || '').toLowerCase();
  return (people || [])
    .filter((p) => !p.guest && !exclude.includes(p.id))
    .filter((p) => !q || personLabel(p).toLowerCase().includes(q) || String(p.email || '').toLowerCase().includes(q))
    .slice(0, 6);
}

/** Put "@Name " in place of the @word being typed. Returns { text, caret }. */
export function insertMention(text, mention, person) {
  const label = `@${personLabel(person)} `;
  const value = String(text || '');
  const end = mention.start + 1 + mention.query.length;
  return { text: value.slice(0, mention.start) + label + value.slice(end), caret: mention.start + label.length };
}

/** The picked people still named in the text (someone may have deleted the @Name). */
export function mentionsInText(text, picked) {
  const value = String(text || '');
  return (picked || []).filter((p) => value.includes(`@${personLabel(p)}`)).map((p) => p.id).slice(0, MARK_COMMENT_MAX_MENTIONS);
}

/** Split a body into text and @mention pieces for display. */
export function commentPieces(body, mentionIds, peopleById) {
  const names = (mentionIds || [])
    .map((id) => peopleById?.get?.(id))
    .filter(Boolean)
    .map((p) => `@${personLabel(p)}`)
    .sort((a, b) => b.length - a.length);
  const value = String(body || '');
  if (!names.length) return [{ text: value }];
  const pieces = [];
  let i = 0;
  while (i < value.length) {
    let hit = null;
    let at = value.length;
    for (const name of names) {
      const found = value.indexOf(name, i);
      if (found >= 0 && found < at) { at = found; hit = name; }
    }
    if (!hit) { pieces.push({ text: value.slice(i) }); break; }
    if (at > i) pieces.push({ text: value.slice(i, at) });
    pieces.push({ text: hit, mention: true });
    i = at + hit.length;
  }
  return pieces;
}
