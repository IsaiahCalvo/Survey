/**
 * presenceIdentity.js — what a person in the "who's here" row looks like, and
 * what we can honestly say about them. Shared by the desktop sidebar footer
 * (PresenceAvatars) and the phone's active-users button and sheet, so one
 * person has the same initials, the same tint and the same status everywhere.
 *
 * Design reference (owner 2026-10-02): the Astryx design system Avatar,
 * AvatarGroup, AvatarGroupOverflow and AvatarStatusDot pages, measured in a
 * browser (scratchpad/avatars):
 *   - initials on a calm fill, weight 500, about 0.4x the face size;
 *   - in a group every face carries a 2px ring in the surface colour and
 *     overlaps its neighbour by a quarter of its size (sm 24px: -6px);
 *   - the overflow "+N" is the same size and shape as a face, a neutral fill
 *     with muted text, and grows into a pill (8px side padding) for two digits;
 *   - the status dot sits ON the circle's edge at 4:30 (its centre is r/sqrt2
 *     right and down from the face's centre), carries the same surface ring,
 *     and pairs colour with shape: success = filled green, neutral = a hollow
 *     grey ring. Inner dot = 1/3 of the face (lg 48px -> 16px + 2px ring).
 *
 * WHAT THE STATUS DOT CAN KNOW. Presence comes from `document_presence`, which
 * the viewer already reads for THIS document only (useDocumentPresenceList).
 * A row is written when someone opens the document and again on every page
 * change; rows older than 2 minutes are dropped (presenceRoster.js). So every
 * person in the list is on this document, and `last_seen` tells us how
 * recently they did something here. That gives two honest states:
 *   here  — last activity within the last minute (or it is you): calm green.
 *   idle  — still on the document, but nothing for 1-2 minutes: hollow grey.
 * "In the project but on another document" would need a new query across
 * every document in the project, which the owner's small-database-traffic rule
 * rules out, so it is not shown.
 */

export const PRESENCE_IDLE_MS = 60 * 1000;

/** Initials: email -> the part before "@" split on . _ -; a name -> first and
 *  last word. Matches Astryx's "first + last" rule. */
export function presenceInitials(value) {
  const name = String(value || '').trim();
  if (!name) return '?';
  const source = name.includes('@') ? name.slice(0, name.indexOf('@')) : name;
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return (parts[0] || source).slice(0, 2).toUpperCase() || '?';
}

/** THE label rule, desktop and phone alike (owner 2026-10-02): the person's
 *  name, falling back to their email. A `document_presence` row carries only
 *  `display_name`, which the viewer writes as the email, so a peer reads as
 *  their email; you read as your account name once presenceRowForUser has put
 *  it on your row. */
export function presenceLabel(row) {
  return row?.name || row?.full_name || row?.display_name || row?.displayName || row?.email || row?.user_id || 'Someone';
}

/** Your own row carries your account name (both rosters call this, so the
 *  footer and the phone sheet say the same thing about you). */
export function presenceRowForUser(row, { currentUserId = null, currentUserDisplayName = null } = {}) {
  if (!row || !currentUserDisplayName || !currentUserId || row.user_id !== currentUserId) return row;
  return { ...row, name: currentUserDisplayName };
}

/** The row that stands in for you before your own presence row has synced:
 *  your name, else your email, else "You". */
export function presenceSelfRow({ currentUserId = null, currentUserEmail = null, currentUserDisplayName = null } = {}) {
  return {
    user_id: currentUserId,
    name: currentUserDisplayName || null,
    display_name: currentUserEmail || 'You',
  };
}

/**
 * One row per person (a user can have several client rows: web, desktop —
 * keep the most recently seen), you first, then most recently seen.
 * You are always on your own list: before your row has synced, and also after
 * it has aged out (2 min without activity) while other people's are fresh.
 */
export function presencePeopleRows(presence = [], { currentUserId = null, currentUserEmail = null, currentUserDisplayName = null } = {}) {
  const byUser = new Map();
  for (const entry of presence || []) {
    const id = entry?.user_id;
    if (!id) continue;
    const prior = byUser.get(id);
    if (!prior || (entry.last_seen && entry.last_seen > (prior.last_seen || ''))) byUser.set(id, entry);
  }
  const list = Array.from(byUser.values());
  if (currentUserId && !byUser.has(currentUserId)) {
    list.push(presenceSelfRow({ currentUserId, currentUserEmail, currentUserDisplayName }));
  }
  list.sort((a, b) => {
    if (a.user_id === currentUserId) return -1;
    if (b.user_id === currentUserId) return 1;
    return (b.last_seen || '').localeCompare(a.last_seen || '');
  });
  return list;
}

/*
 * Tints. Per-person identity hues are outside the chrome palette (tokens.css,
 * "NOT IN SCOPE": they are the same class of thing as an ink colour), so they
 * are literals here — but calm ones: every fill is a dark, low-saturation tone
 * that reads as a colour without shouting, and --text-1 (#dadfe8) on each
 * measures at least 5.6:1 (WCAG AA wants 4.5:1).
 *   you    #4a505c  grey   6.05:1  (owner: "gray is fine" — never blue)
 *   others #2f5759  teal   5.97:1
 *          #54476a  plum   6.31:1
 *          #6b4a3c  clay   5.88:1
 *          #4e5838  moss   5.65:1
 *          #6a4452  rose   6.13:1
 *          #44516a  slate  5.97:1  (a grey-blue at ~22% saturation, not a
 *                                   saturated blue)
 * No gold: gold means "selected" in this app.
 */
export const PRESENCE_SELF_TINT = '#4a505c';
export const PRESENCE_PEER_TINTS = ['#2f5759', '#54476a', '#6b4a3c', '#4e5838', '#6a4452', '#44516a'];
export const PRESENCE_INK = 'var(--text-1)';

function hashId(id) {
  let hash = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return hash;
}

/**
 * Tint per person: each peer starts at the slot their id hashes to; when two
 * peers in the same roster would share a slot, the later one takes the next
 * free slot. Up to six peers therefore always get six different tints;
 * past six a second round starts (each tint at most twice for 12 peers), and
 * the names in the list tell the repeats apart.
 * Returns Map(userId -> tint).
 */
export function assignPresenceTints(userIds = [], currentUserId = null) {
  const out = new Map();
  const unique = [...new Set(userIds.filter((id) => id && id !== currentUserId))];
  // Six or fewer: by id, so a person keeps their tint as others come and go.
  // More than six: in the order given (the display order - most recent
  // first), so the faces on show and each run of six rows in the list are
  // all different.
  const peers = unique.length <= PRESENCE_PEER_TINTS.length ? [...unique].sort() : unique;
  const used = new Set();
  for (const id of peers) {
    // Every tint is used once before any is used twice, then a fresh round.
    if (used.size >= PRESENCE_PEER_TINTS.length) used.clear();
    let slot = hashId(id) % PRESENCE_PEER_TINTS.length;
    while (used.has(slot)) slot = (slot + 1) % PRESENCE_PEER_TINTS.length;
    used.add(slot);
    out.set(id, PRESENCE_PEER_TINTS[slot]);
  }
  if (currentUserId) out.set(currentUserId, PRESENCE_SELF_TINT);
  return out;
}

/** 'here' | 'idle' for one presence row (see the header comment). */
export function presenceState(row, { now = Date.now(), isCurrent = false } = {}) {
  if (isCurrent) return 'here';
  const ts = Date.parse(row?.last_seen || row?.lastSeen || '');
  if (!Number.isFinite(ts)) return 'here';
  return now - ts <= PRESENCE_IDLE_MS ? 'here' : 'idle';
}

export const PRESENCE_STATE_LABEL = { here: 'Here now', idle: 'Idle' };

/*
 * DEV ONLY — fake a room full of people so the footer can be looked at and
 * screenshotted without a second account: add `?fakePeers=N` (N = everyone,
 * you included, 1-40) to a dev URL. Every second peer is idle. Compiled out of
 * production builds (import.meta.env.DEV is false there).
 */
const FAKE_NAMES = [
  'isaiah.calvo@surveytool.app', 'maria.lopez@example.com', 'devon.reid@example.com',
  'priya.nair@example.com', 'tom.becker@example.com', 'aiko.tanaka@example.com',
  'sam.okafor@example.com', 'lena.fischer@example.com', 'jorge.ruiz@example.com',
  'nora.walsh@example.com', 'ben.cho@example.com', 'ruth.adler@example.com',
];

export function readDevFakePeerCount() {
  try {
    if (!import.meta.env?.DEV || typeof window === 'undefined') return null;
    const raw = new URLSearchParams(window.location.search).get('fakePeers');
    if (raw == null) return null;
    const n = Math.round(Number(raw));
    return Number.isFinite(n) && n >= 1 ? Math.min(n, 40) : null;
  } catch {
    return null;
  }
}

export function buildFakePresence(count, now = Date.now()) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const email = FAKE_NAMES[i] || `guest.${i + 1}@example.com`;
    const idle = i > 0 && i % 2 === 0;
    rows.push({
      id: `dev-fake-${i}`,
      user_id: i === 0 ? 'dev-fake-you' : `dev-fake-peer-${i}`,
      display_name: email,
      client_type: 'app',
      current_page: 1,
      last_seen: new Date(now - (idle ? 90000 : i * 4000)).toISOString(),
    });
  }
  return rows;
}

/** Wrap the presence inputs of a surface: when the dev flag is on, swap in the
 *  fake roster and fake "you"; otherwise return the inputs unchanged. */
export function withDevFakePresence(inputs) {
  const n = readDevFakePeerCount();
  if (!n) return { ...inputs, fake: false };
  return {
    ...inputs,
    presence: buildFakePresence(n),
    currentUserId: 'dev-fake-you',
    currentUserEmail: FAKE_NAMES[0],
    currentUserDisplayName: FAKE_NAMES[0],
    fake: true,
  };
}
