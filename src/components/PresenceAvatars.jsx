import { useState } from 'react';
// KAL-65: the active users hover hints render from the ONE shared tooltip
// surface so they match the sync status hint and the toolbar/rail tooltips.
import { AnchoredTooltip } from './Tooltip';

/**
 * Live presence row — Microsoft Excel / Google Docs pattern.
 *
 * Renders up to three overlapping circles for users currently viewing the
 * document. A fourth slot is reserved for a "+N" pill when more than three
 * are present. A small "N viewing" count sits beneath the pile.
 *
 * Hover behavior:
 *   - Hovering a single avatar shows that user's email below the circle.
 *   - Hovering the "+N" pill opens a dropdown listing every viewer with
 *     their name and email.
 *
 * Inputs:
 *   - presence: array of rows from `document_presence`. Each row has
 *     `user_id` and `display_name` (we put email there at write time).
 *   - currentUserId / currentUserEmail / currentUserDisplayName: identifies
 *     the local user so we can pin them to the leftmost slot and label
 *     them "(you)" in the dropdown.
 *   - enabled: hide the row entirely when cloud sync isn't on.
 */
export default function PresenceAvatars({
  presence = [],
  currentUserId = null,
  currentUserEmail = null,
  currentUserDisplayName = null,
  enabled = true,
  compact = false
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  if (!enabled) return null;

  // Deduplicate by user_id — a user can have multiple client_type rows
  // (web, desktop). Keep the most recently seen row per user.
  const uniqueByUser = new Map();
  for (const row of (presence || [])) {
    const id = row?.user_id;
    if (!id) continue;
    const prior = uniqueByUser.get(id);
    if (!prior || (row.last_seen && row.last_seen > (prior.last_seen || ''))) {
      uniqueByUser.set(id, row);
    }
  }
  let users = Array.from(uniqueByUser.values());
  if (users.length === 0) {
    // Fallback: at least show the local user so the row is never blank
    // when the local presence row hasn't synced yet.
    if (currentUserId) {
      users = [{
        user_id: currentUserId,
        display_name: currentUserEmail || currentUserDisplayName || 'You'
      }];
    } else {
      return null;
    }
  }

  // Sort: local user first, then most recently seen.
  users.sort((a, b) => {
    if (a.user_id === currentUserId) return -1;
    if (b.user_id === currentUserId) return 1;
    return (b.last_seen || '').localeCompare(a.last_seen || '');
  });

  const total = users.length;
  const visibleCap = 3; // user requirement: max three faces, fourth slot = pill
  const hasOverflow = total > visibleCap;
  const visibleUsers = hasOverflow ? users.slice(0, visibleCap) : users;
  const overflowUsers = hasOverflow ? users.slice(visibleCap) : [];

  // Compact mode (collapsed sidebar rail) shrinks the avatars and hides
  // the "N viewing" caption so the row fits inside the 48px-wide rail.
  const avatarSize = compact ? 18 : 22;
  const overlap = compact ? -8 : -10;
  const initialsFontSize = compact ? 8 : 9;

  const initialsOf = (row) => {
    const name = row?.display_name || row?.user_id || '?';
    // Email-style: take first letter before "@"; otherwise first two
    // letters of the display name (handles "First Last" → "FL").
    const at = name.indexOf('@');
    if (at > 0) {
      const prefix = name.slice(0, at);
      const parts = prefix.split(/[._-]/).filter(Boolean);
      if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
      return prefix.slice(0, 2).toUpperCase();
    }
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  };

  // Stable color per user_id — same person always gets the same color.
  const colorOf = (userId) => {
    if (userId === currentUserId) return 'linear-gradient(135deg, #6c8aff, #4f8cff)'; // You = blue
    let hash = 0;
    for (let i = 0; i < (userId || '').length; i++) {
      hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
    }
    const palettes = [
      'linear-gradient(135deg, #2bbd7e, #1f9c66)', // green
      'linear-gradient(135deg, #f5a524, #e08600)', // orange
      'linear-gradient(135deg, #ef4444, #c63333)', // red
      'linear-gradient(135deg, #b86cff, #8a4fff)', // purple
      'linear-gradient(135deg, #ff6cb3, #ff4f9c)', // pink
      'linear-gradient(135deg, #6cd0ff, #4fb5ff)'  // cyan
    ];
    return palettes[hash % palettes.length];
  };

  const emailOf = (row) => row?.display_name || '';

  return (
    <div
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2px',
        position: 'relative'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {visibleUsers.map((row, idx) => (
          <Avatar
            key={row.user_id}
            initials={initialsOf(row)}
            background={colorOf(row.user_id)}
            email={emailOf(row)}
            offset={idx > 0 ? `${overlap}px` : '0'}
            size={avatarSize}
            fontSize={initialsFontSize}
            tooltipDirection={compact ? 'right' : 'bottom'}
          />
        ))}
        {hasOverflow && (
          <div
            style={{ position: 'relative', marginLeft: `${overlap}px` }}
            onMouseEnter={() => setPopoverOpen(true)}
            onMouseLeave={() => setPopoverOpen(false)}
          >
            <div
              style={{
                width: `${avatarSize}px`,
                height: `${avatarSize}px`,
                borderRadius: '50%',
                /* UX: the "+N" bubble is a raised neutral disc sitting among
                   the per-person identity colours, so it takes the raised
                   surface token instead of a white wash whose meaning would
                   change with whatever is behind the rail. */
                background: 'var(--surface-3)',
                color: 'var(--text-1)',
                border: '2px solid var(--surface-0)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: `${initialsFontSize}px`,
                fontWeight: 600,
                cursor: 'default'
              }}
            >
              +{overflowUsers.length}
            </div>
            {popoverOpen && (
              <div
                style={{
                  position: 'absolute',
                  // 2026-04-25 — In the collapsed sidebar rail the popover
                  // slides out to the right (matching the rail's tab
                  // tooltips) so it doesn't get clipped by the rail edge.
                  // In the expanded toolbar layout we keep it below,
                  // anchored to the right of the pile.
                  ...(compact
                    ? { left: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)' }
                    : { top: 'calc(100% + 6px)', right: 0 }),
                  background: '#11131a',
                  /* UX: the popover already reads as a separate layer from its
                     own dark fill and drop shadow, so its edge is decorative —
                     the subtle hairline, not a white wash. */
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '8px 0',
                  minWidth: '240px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  zIndex: 1000
                }}
              >
                <div
                  style={{
                    padding: '4px 12px 8px',
                    fontSize: '10px',
                    color: '#9aa0a8',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    /* UX: a separator under the "N viewing" caption — purely a
                       divider, so the subtle border token. */
                    borderBottom: '1px solid var(--border)',
                    marginBottom: '4px'
                  }}
                >
                  {total} viewing
                </div>
                {users.map((row) => (
                  <div
                    key={row.user_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '6px 12px',
                      fontSize: '12px',
                      color: '#e6e8eb'
                    }}
                  >
                    <span
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: colorOf(row.user_id),
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-1)',
                        fontSize: '8px',
                        fontWeight: 600,
                        flexShrink: 0
                      }}
                    >
                      {initialsOf(row)}
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.user_id === currentUserId ? `${emailOf(row) || 'You'} (you)` : emailOf(row) || row.user_id}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {/* Caption — active-users count.
          UX (2026-07-17, E2E finding): with the rail collapsed the full
          "N viewing" text doesn't fit the 48px rail ("12 viewing" ≈ 48px at
          10px type), but hiding it entirely left collapsed users with no
          at-a-glance signal that other people are viewing the document.
          Intended behavior: expanded rail keeps the full "just you" /
          "N viewing" caption (unchanged); the collapsed rail shows a compact
          count — just the number, same 10px muted caption style — under the
          dot pile whenever someone else is present, with a right-slide hover
          tooltip reading "N viewing" that matches the collapsed rail's
          existing tab / sync-status tooltips (reference behavior). When the
          user is alone, compact mode stays caption-less so the collapsed
          rail keeps its minimal look. */}
      {!compact && (
        <div style={{ fontSize: '10px', color: '#9aa0a8', lineHeight: 1 }}>
          {total === 1 ? 'just you' : `${total} viewing`}
        </div>
      )}
      {compact && total > 1 && <CompactViewerCount total={total} />}
    </div>
  );
}

// Compact active-users count for the collapsed sidebar rail: the bare
// number in the same muted caption style, with a right-slide hover tooltip
// spelling out "N viewing" — identical tooltip style/geometry to the rail's
// tab tooltips and the compact sync status indicator. The tooltip lives on
// the count (not the dot pile) so it never fights the per-user email
// tooltips on the dots or the "+N" viewer-list popover.
function CompactViewerCount({ total }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="status"
      aria-label={`${total} viewing`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        fontSize: '10px',
        color: '#9aa0a8',
        lineHeight: 1,
        // Widen the hover target a touch — a bare 10px digit is a tiny mark.
        padding: '2px 6px',
        cursor: 'default'
      }}
    >
      {total}
      {hover && (
        <AnchoredTooltip side="right">
          {total} viewing
        </AnchoredTooltip>
      )}
    </div>
  );
}

// Single avatar with a hover-tooltip showing the user's email.
// `tooltipDirection` is 'right' for the collapsed sidebar rail (matches the
// existing Pages / Search / Bookmarks tab tooltips that slide out to the
// right) and 'bottom' for the expanded layout where the row has more
// horizontal space and a downward tooltip is more comfortable.
function Avatar({ initials, background, email, offset = '0', size = 22, fontSize = 9, tooltipDirection = 'bottom' }) {
  const [hover, setHover] = useState(false);
  const tooltipPosition = tooltipDirection === 'right'
    ? { left: 'calc(100% + 8px)', top: '50%', transform: 'translateY(-50%)' }
    : { top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' };
  return (
    <div
      style={{ position: 'relative', marginLeft: offset }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '50%',
          background,
          color: 'var(--text-1)',
          fontSize: `${fontSize}px`,
          fontWeight: 600,
          border: '2px solid var(--surface-0)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'default'
        }}
      >
        {initials}
      </span>
      {hover && email && (
        <AnchoredTooltip position={tooltipPosition}>
          {email}
        </AnchoredTooltip>
      )}
    </div>
  );
}
