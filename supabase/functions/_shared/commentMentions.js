// Pure rules for the @mention email (notify-comment-mentions). Plain JS so the
// Node test runner can import it.

export const MENTION_EMAIL_WINDOW_MS = 15 * 60 * 1000;
export const MENTION_EXCERPT_CHARS = 280;
// The app the link opens: Survey Nightly (where comments live while in beta)
// or the stable site. Anything else falls back to the stable site.
export const MENTION_LINK_ORIGINS = Object.freeze([
  'https://surveytool.app',
  'https://surveytool-nightly.vercel.app',
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Why a comment's mentions may not be emailed now, or null when they may:
 * only its author asks, once, soon after posting, while it still stands.
 */
export function mentionEmailRefusal(comment, callerId, nowMs = Date.now()) {
  if (!comment) return 'not-found';
  if (comment.author_id !== callerId) return 'not-author';
  if (comment.deleted_at) return 'deleted';
  if (comment.mentions_notified_at) return 'already-sent';
  const created = Date.parse(comment.created_at);
  if (!Number.isFinite(created) || nowMs - created > MENTION_EMAIL_WINDOW_MS) return 'too-late';
  return null;
}

/** Who to email: each mentioned person once, never the author. */
export function mentionRecipients(comment) {
  const seen = new Set();
  for (const id of comment?.mentions || []) {
    if (isUuid(id) && id !== comment.author_id) seen.add(id);
  }
  return [...seen];
}

export function commentExcerpt(body, max = MENTION_EXCERPT_CHARS) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function mentionLinkOrigin(requested) {
  return MENTION_LINK_ORIGINS.includes(requested) ? requested : MENTION_LINK_ORIGINS[0];
}

/** The link that opens the document at the comment (AppShell ?docId=&comment=). */
export function commentLink(origin, documentId, commentId) {
  const url = new URL(mentionLinkOrigin(origin));
  url.searchParams.set('docId', documentId);
  url.searchParams.set('comment', commentId);
  return url.toString();
}
