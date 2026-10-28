// src/services/guestLinks.js
//
// Guest links (Nightly, flag 'guest-links'; migration
// 20261028052000_guest_links.sql): a document's owner makes a link that lets
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

export async function revokeGuestLink(client, linkId) {
  const { error } = await client.rpc('revoke_guest_link', { p_link_id: linkId });
  if (error) throw new Error(error.message || 'Could not turn the link off');
}

/** Live links first, with who came in through each. */
export async function listGuestLinks(client, documentId) {
  const [links, guests] = await Promise.all([
    client.from('document_guest_links').select('id, role, expires_at, revoked_at, created_at, use_count').eq('document_id', documentId).order('created_at', { ascending: false }),
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
    revoked: Boolean(l.revoked_at),
    guests: byLink.get(l.id) || [],
  }));
}

export async function redeemGuestLink(client, { token, name }) {
  const { data, error } = await client.rpc('redeem_guest_link', { p_token: token, p_name: cleanGuestName(name) });
  if (error) throw new Error(error.message || 'Could not open the guest link');
  const row = rowOf(data);
  return row ? { documentId: row.document_id, documentName: row.document_name, role: row.role, expiresAt: row.expires_at } : null;
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
