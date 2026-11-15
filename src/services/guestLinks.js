// src/services/guestLinks.js
//
// Guest links (flag 'guest-links'; migration
// 20261028070000_guest_links.sql): a document's owner makes a link that lets
// someone with no account open that one document, as viewer or editor, until
// a set time. The link's secret is shown once; the server keeps a hash.

import { GUEST_LINK_PARAM } from './guestLinkToken.js';

// Read from the address bar at load, so kept in a small module of its own.
export { GUEST_LINK_PARAM, guestTokenFrom } from './guestLinkToken.js';
export const GUEST_LINK_DURATIONS = Object.freeze(['4 hours', '1 day', '1 week', '1 month', '2 months', '6 months']);
export const GUEST_NAME_MAX = 60;

export function guestLinkUrl(token, origin = globalThis.location?.origin || '') {
  return `${origin}/?${GUEST_LINK_PARAM}=${encodeURIComponent(token)}`;
}

export function cleanGuestName(name) {
  // eslint-disable-next-line no-control-regex
  return String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, GUEST_NAME_MAX);
}

const rowOf = (data) => (Array.isArray(data) ? data[0] : data) || null;

export async function createGuestLink(client, { documentId, role, expiresIn }) {
  const { data, error } = await client.rpc('create_guest_link', { p_document_id: documentId, p_role: role, p_expires_in: expiresIn });
  if (error) throw new Error(error.message || 'Could not make the guest link');
  const row = rowOf(data);
  return row ? { id: row.id, token: row.token, role: row.role, expiresAt: row.expires_at } : null;
}

/** Put a password on a link (4 to 128 characters), or take it off with ''. */
export async function setGuestLinkPassword(client, linkId, password) {
  const { error } = await client.rpc('set_guest_link_password', { p_link_id: linkId, p_password: password || null });
  if (error) throw new Error(error.message || 'Could not set the password');
}

export async function revokeGuestLink(client, linkId) {
  const { error } = await client.rpc('revoke_guest_link', { p_link_id: linkId });
  if (error) throw new Error(error.message || 'Could not turn the link off');
}

/** Live links first, with who came in through each. */
export async function listGuestLinks(client, documentId) {
  const [links, guests] = await Promise.all([
    client.from('document_guest_links').select('id, role, expires_at, revoked_at, created_at, use_count, has_password').eq('document_id', documentId).order('created_at', { ascending: false }),
    client.from('document_guests').select('link_id, display_name, joined_at').eq('document_id', documentId),
  ]);
  if (links.error) throw new Error(links.error.message || 'Could not read the guest links');
  const byLink = new Map();
  for (const g of guests.data || []) {
    if (!byLink.has(g.link_id)) byLink.set(g.link_id, []);
    byLink.get(g.link_id).push(g.display_name);
  }
  const now = Date.now();
  return (links.data || []).map((l) => ({
    id: l.id,
    role: l.role,
    expiresAt: l.expires_at,
    createdAt: l.created_at,
    live: !l.revoked_at && Date.parse(l.expires_at) > now,
    hasPassword: l.has_password === true,
    revoked: Boolean(l.revoked_at),
    guests: byLink.get(l.id) || [],
  }));
}

export const GUEST_PASSWORD_MIN = 4;
export const GUEST_PASSWORD_MAX = 128;

// What the guest sees for each answer of redeem_guest_link_checked (KAL-401).
export const GUEST_PASSWORD_MESSAGES = Object.freeze({
  password: 'This link needs a password. Ask the person who shared it.',
  wrong: 'That password is not right. Try again.',
  locked: 'Too many attempts. Try again later.',
});

/**
 * Open a guest link. Resolves { status: 'ok', documentId, ... } or
 * { status: 'password' | 'wrong' | 'locked', message } when the link has a
 * password; an ended or unknown link throws.
 */
export async function redeemGuestLink(client, { token, name, password = null }) {
  const { data, error } = await client.rpc('redeem_guest_link_checked', { p_token: token, p_name: cleanGuestName(name), p_password: password || null });
  if (error) throw new Error(error.message || 'Could not open the guest link');
  const row = rowOf(data);
  if (!row || typeof row !== 'object') return null;
  if (row.status && row.status !== 'ok') return { status: row.status, message: GUEST_PASSWORD_MESSAGES[row.status] || 'Could not open the guest link' };
  return { status: 'ok', documentId: row.document_id, documentName: row.document_name, role: row.role, expiresAt: row.expires_at };
}

/** "Ends in 3 hours", "Ends tomorrow", "Ends Nov 30". */
export function guestLinkEnds(expiresAt, now = Date.now()) {
  const ms = Date.parse(expiresAt) - now;
  if (!(ms > 0)) return 'Ended';
  const hours = Math.round(ms / 3600000);
  if (hours < 1) return 'Ends within the hour';
  if (hours < 24) return `Ends in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(ms / 86400000);
  if (days <= 1) return 'Ends tomorrow';
  if (days < 7) return `Ends in ${days} days`;
  return `Ends ${new Date(expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: days > 300 ? 'numeric' : undefined })}`;
}
