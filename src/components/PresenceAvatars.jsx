import { useEffect, useMemo, useRef, useState } from 'react';
// KAL-65: hover layers paint from the ONE shared tooltip surface so the people
// list matches the sync status hint and the rail tooltips beside it.
import { TOOLTIP_SURFACE } from './Tooltip';
import {
  PRESENCE_INK,
  PRESENCE_STATE_LABEL,
  assignPresenceTints,
  presenceInitials,
  presenceLabel,
  presenceRowForUser,
  presenceSelfRow,
  presenceState,
} from './presenceIdentity.js';

/**
 * Who is on this document — the people token in the desktop sidebar footer.
 *
 * Owner 2026-10-02: designed against the Astryx Avatar / AvatarGroup /
 * AvatarGroupOverflow / AvatarStatusDot docs (measured specs are in
 * presenceIdentity.js). In this footer:
 *   - a face is 24px (Astryx "sm") with a 2px ring in the footer's own surface
 *     colour, so the ring reads as a cut-out and the face sits in the 28px
 *     desktop row; neighbours overlap by a quarter (6px), each face over the
 *     one before it, with every status dot on top of all of them;
 *   - the "+N" is the same 24px circle (a pill once N has two digits) on a
 *     neutral raised fill with muted text;
 *   - the status dot is 8px + the same 2px ring, centred on the face's edge at
 *     4:30: calm green = here now, hollow grey ring = idle (shape, not only
 *     colour, tells them apart);
 *   - you are always first, in calm grey; other people get muted tints.
 *
 * Fit (the footer never wraps or overflows):
 *   expanded rail (`row`)   — three slots in a row: up to three faces, or two
 *                             faces + "+N". The sync status stays in the true
 *                             middle and its side columns are ~71px wide; three
 *                             slots measure 24 + 22 + 22 = 68px ("+10": 70px).
 *   collapsed rail (`compact`) — two slots stacked in the 36px column: up to
 *                             two faces, or you + "+N".
 * Hovering, focusing or tapping the group opens the full list (name + status),
 * upward in the expanded row, out to the right from the collapsed rail.
 *
 * Inputs:
 *   - presence: rows from `document_presence` (user_id, display_name — the
 *     email is stored there — and last_seen).
 *   - currentUserId / currentUserEmail / currentUserDisplayName: the local user,
 *     pinned first and shown even before their own row has synced.
 *   - enabled: hide entirely when cloud sync is off.
 */
const FACE = 24;
const RING = 2;
// Astryx overlaps ring-to-ring by a quarter of the face (sm: 6px of the 28px
// ringed circle). Our rings are drawn outside the 24px box, so in layout terms
// the faces overlap by 6 - 2 x 2 = 2px: a 22px step, and 20px of each face
// stays clear of the next, enough for two initials.
const OVERLAP = 6;
const STEP_OVERLAP = OVERLAP - RING * 2;
const DOT = 8;
const LIST_FACE = 20;

export default function PresenceAvatars({
  presence = [],
  currentUserId = null,
  currentUserEmail = null,
  currentUserDisplayName = null,
  enabled = true,
  // `row` (the expanded footer) is the default layout; only `compact` changes it.
  compact = false,
}) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinnedOpen, setPinnedOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef(null);

  const users = useMemo(() => {
    // One entry per person: a user can have several client rows (web,
    // desktop). Keep the most recently seen.
    const byUser = new Map();
    for (const entry of presence || []) {
      const id = entry?.user_id;
      if (!id) continue;
      const prior = byUser.get(id);
      if (!prior || (entry.last_seen && entry.last_seen > (prior.last_seen || ''))) byUser.set(id, entry);
    }
    let list = Array.from(byUser.values());
    if (list.length === 0 && currentUserId) {
      list = [presenceSelfRow({ currentUserId, currentUserEmail, currentUserDisplayName })];
    }
    list.sort((a, b) => {
      if (a.user_id === currentUserId) return -1;
      if (b.user_id === currentUserId) return 1;
      return (b.last_seen || '').localeCompare(a.last_seen || '');
    });
    const tints = assignPresenceTints(list.map((u) => u.user_id), currentUserId);
    return list.map((u) => {
      const isCurrent = u.user_id === currentUserId;
      const label = presenceLabel(presenceRowForUser(u, { currentUserId, currentUserDisplayName }));
      return { id: u.user_id, row: u, isCurrent, label, initials: presenceInitials(label), tint: tints.get(u.user_id) };
    });
  }, [presence, currentUserId, currentUserEmail, currentUserDisplayName]);

  const hasPeers = users.some((u) => !u.isCurrent);
  // "Idle" is a time threshold, so re-read the clock now and then while other
  // people are listed. Local only — no network.
  useEffect(() => {
    if (!enabled || !hasPeers) return undefined;
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, [enabled, hasPeers]);

  // A tapped-open list closes on a press anywhere else, or on Escape.
  useEffect(() => {
    if (!pinnedOpen) return undefined;
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setPinnedOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setPinnedOpen(false); setHoverOpen(false); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinnedOpen]);

  if (!enabled || users.length === 0) return null;

  const people = users.map((u) => ({ ...u, state: presenceState(u.row, { now, isCurrent: u.isCurrent }) }));
  const total = people.length;
  const slots = compact ? 2 : 3;
  const hasOverflow = total > slots;
  const visible = hasOverflow ? people.slice(0, slots - 1) : people;
  const hiddenCount = total - visible.length;
  const vertical = compact;
  const listOpen = hoverOpen || pinnedOpen;
  const hereCount = people.filter((p) => p.state === 'here').length;
  const summary = total === 1
    ? 'Just you on this document'
    : `${total} people on this document${hereCount < total ? `, ${total - hereCount} idle` : ''}`;

  const listPosition = compact
    // Out to the right of the collapsed rail, bottom-aligned so a long list
    // grows upward instead of off the bottom of the window.
    ? { left: '100%', bottom: 0, paddingLeft: '12px' }
    // Upward from the expanded footer row, aligned to the faces' left edge.
    : { left: 0, bottom: '100%', paddingBottom: '8px' };

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setHoverOpen(true)}
      onMouseLeave={() => setHoverOpen(false)}
    >
      <button
        type="button"
        data-presence-group=""
        aria-label={summary}
        aria-expanded={listOpen}
        onClick={() => setPinnedOpen((open) => !open)}
        onFocus={(e) => { if (e.currentTarget.matches?.(':focus-visible')) setHoverOpen(true); }}
        onBlur={() => setHoverOpen(false)}
        style={{
          display: 'flex',
          flexDirection: vertical ? 'column' : 'row',
          alignItems: 'center',
          // The 2px rings are drawn outside each 24px face, so leave room for
          // them inside the button (and inside the 28px row).
          padding: `${RING}px`,
          margin: `-${RING}px`,
          border: 0,
          background: 'transparent',
          borderRadius: '14px',
          cursor: 'default',
          font: 'inherit',
          color: 'inherit',
        }}
      >
        {visible.map((person, idx) => (
          <Face
            key={person.id}
            person={person}
            offset={idx > 0 ? -STEP_OVERLAP : 0}
            vertical={vertical}
          />
        ))}
        {hasOverflow && (
          <span
            data-presence-overflow=""
            aria-hidden="true"
            style={{
              position: 'relative',
              zIndex: 1,
              [vertical ? 'marginTop' : 'marginLeft']: `-${STEP_OVERLAP}px`,
              minWidth: `${FACE}px`,
              height: `${FACE}px`,
              boxSizing: 'border-box',
              // A pill once N has two digits, like Astryx's overflow.
              padding: '0 4px',
              borderRadius: `${FACE / 2}px`,
              background: 'var(--surface-3)',
              color: 'var(--text-2)',
              boxShadow: `0 0 0 ${RING}px var(--surface-1)`,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: 0,
              flexShrink: 0,
            }}
          >
            +{hiddenCount}
          </span>
        )}
      </button>
      {listOpen && (
        <div
          data-presence-list=""
          style={{ position: 'absolute', zIndex: 3000, ...listPosition }}
        >
          <div
            role="dialog"
            aria-label="People on this document"
            style={{
              ...TOOLTIP_SURFACE,
              whiteSpace: 'normal',
              pointerEvents: 'auto',
              padding: '4px 0',
              width: '248px',
              maxHeight: '320px',
              overflowY: 'auto',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ padding: '4px 12px 6px', fontSize: '11px', color: 'var(--text-3)' }}>
              {total === 1 ? 'Just you on this document' : `${total} on this document`}
            </div>
            {people.map((person) => (
              <div
                key={person.id}
                data-presence-row={person.state}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  height: 'var(--menu-item-h, 28px)',
                  padding: '0 12px',
                  fontSize: '12px',
                  color: 'var(--text-1)',
                }}
              >
                <Face person={person} size={LIST_FACE} dot={6} ringColor="var(--surface-2)" />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {person.label}{person.isCurrent ? ' (you)' : ''}
                </span>
                <span style={{ flexShrink: 0, fontSize: '11px', color: person.state === 'here' ? 'var(--text-2)' : 'var(--text-3)' }}>
                  {PRESENCE_STATE_LABEL[person.state]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// One face: initials on the person's tint, a ring in the surface colour, and
// the status dot on the edge at 4:30. In a group each face paints over the one
// before it (Astryx order) but every status dot paints above all the faces,
// its surface ring cutting a clean notch into the next face.
function Face({ person, offset = 0, vertical = false, size = FACE, dot = DOT, ringColor = 'var(--surface-1)' }) {
  const inGroup = size === FACE;
  // Centre of the dot on the circle at 45 degrees: r / sqrt(2) from the centre.
  const dotOuter = dot + RING * 2;
  const centre = size / 2 + (size / 2) / Math.SQRT2;
  return (
    <span
      data-presence-face={person.id}
      aria-hidden="true"
      style={{
        position: 'relative',
        [vertical ? 'marginTop' : 'marginLeft']: offset ? `${offset}px` : undefined,
        width: `${size}px`,
        height: `${size}px`,
        flexShrink: 0,
        borderRadius: '50%',
        background: person.tint,
        color: PRESENCE_INK,
        boxShadow: inGroup ? `0 0 0 ${RING}px ${ringColor}` : undefined,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size >= FACE ? '10px' : '8px',
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: 0,
      }}
    >
      {person.initials}
      <span
        data-presence-dot={person.state}
        style={{
          position: 'absolute',
          zIndex: 2,
          left: `${centre - dotOuter / 2}px`,
          top: `${centre - dotOuter / 2}px`,
          width: `${dot}px`,
          height: `${dot}px`,
          borderRadius: '50%',
          border: `${RING}px solid ${ringColor}`,
          // Here: a filled calm green (--success: status dots only). Idle: a
          // hollow grey ring, the Astryx "neutral" shape.
          background: person.state === 'here' ? 'var(--success)' : ringColor,
          boxShadow: person.state === 'here' ? undefined : 'inset 0 0 0 1.5px var(--text-3)',
          boxSizing: 'content-box',
        }}
      />
    </span>
  );
}
