import React, { useState } from 'react';

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
  enabled = true
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
            offset={idx > 0 ? '-10px' : '0'}
          />
        ))}
        {hasOverflow && (
          <div
            style={{ position: 'relative', marginLeft: '-10px' }}
            onMouseEnter={() => setPopoverOpen(true)}
            onMouseLeave={() => setPopoverOpen(false)}
          >
            <div
              style={{
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.08)',
                color: '#ddd',
                border: '2px solid #1E1E1E',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px',
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
                  top: 'calc(100% + 6px)',
                  right: 0,
                  background: '#11131a',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  padding: '8px 0',
                  minWidth: '240px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                  zIndex: 100
                }}
              >
                <div
                  style={{
                    padding: '4px 12px 8px',
                    fontSize: '10px',
                    color: '#9aa0a8',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
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
                        color: 'white',
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
      <div style={{ fontSize: '10px', color: '#9aa0a8', lineHeight: 1 }}>
        {total === 1 ? 'just you' : `${total} viewing`}
      </div>
    </div>
  );
}

// Single avatar with a hover-tooltip showing the user's email.
function Avatar({ initials, background, email, offset = '0' }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      style={{ position: 'relative', marginLeft: offset }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span
        style={{
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          background,
          color: 'white',
          fontSize: '9px',
          fontWeight: 600,
          border: '2px solid #1E1E1E',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'default'
        }}
      >
        {initials}
      </span>
      {hover && email && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#11131a',
            color: '#e6e8eb',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: '6px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            whiteSpace: 'nowrap',
            zIndex: 100,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            pointerEvents: 'none'
          }}
        >
          {email}
        </div>
      )}
    </div>
  );
}
