// src/components/collab/RemoteCursorLayer.jsx
//
// KAL-399: other people's cursors on one page (annotationLiveCursors.js).
//
// UX (Drawboard / Figma feel, kept calm): a small arrow and a name tag in the
// person's own pastel from utils/userColors.js — the same colour and the same
// dark ink as their face in the people list, so "the rose arrow" is "the rose
// face". The arrow is edged in the person's darker `line` twin so it still
// shows on white paper. Nothing here can be clicked (pointer-events: none);
// it never covers a mark from the user's own input.
//
// Zoom: the layer fills the page box and a cursor sits at a PERCENT of it
// (page units / page size), so it lands on the same spot of the page at any
// zoom with no zoom code at all; the arrow and the tag keep their screen size
// like a real pointer. Between messages (~10 a second) the cursor glides
// (CSS), so motion reads smooth without more traffic.
//
// The layer element is also where this screen's own pointer is measured
// (data-live-cursor-layer: page number + page size; useLiveCursorBroadcast).
import React, { useMemo, useSyncExternalStore } from 'react';
import {
  cursorLabel,
  getLiveCursorsForPage,
  getLiveCursorUserIds,
  pagePointToPercent,
  subscribeLiveCursors,
} from '../../services/annotationLiveCursors.js';
import { USER_COLORS, USER_INITIALS_INK, assignUserColors, userColor } from '../../utils/userColors.js';
import './RemoteCursorLayer.css';

const EMPTY = [];
const FALLBACK = USER_COLORS[5];

export default function RemoteCursorLayer({ documentId, pageNumber, pageSize, presence = null, selfId = null }) {
  const cursors = useSyncExternalStore(
    subscribeLiveCursors,
    () => (documentId ? getLiveCursorsForPage(pageNumber, documentId) : EMPTY),
    () => EMPTY,
  );

  // Colours: the same assignment as the people list (PresenceAvatars:
  // everyone on the document plus you, you keep yours, clashes move on), so a
  // cursor always matches its face. A cursor whose person has no presence row
  // yet joins the set.
  const colorByUser = useMemo(() => {
    if (cursors.length === 0) return null;
    const ids = new Set();
    for (const row of Array.isArray(presence) ? presence : EMPTY) if (row?.user_id) ids.add(row.user_id);
    for (const id of getLiveCursorUserIds(documentId)) ids.add(id);
    if (selfId) ids.add(selfId);
    return assignUserColors([...ids], selfId);
  }, [cursors, presence, selfId, documentId]);

  if (!documentId || !pageSize || !(pageSize.width > 0) || !(pageSize.height > 0)) return null;

  return (
    <div
      className="remote-cursor-layer"
      data-live-cursor-layer="true"
      data-document-id={documentId}
      data-page={pageNumber}
      data-page-width={pageSize.width}
      data-page-height={pageSize.height}
      aria-hidden="true"
    >
      {cursors.map((cursor) => {
        const at = pagePointToPercent(cursor.x, cursor.y, pageSize);
        if (!at) return null;
        const color = (cursor.userId && (colorByUser?.get(cursor.userId) || userColor(cursor.userId))) || FALLBACK;
        return (
          <div
            key={cursor.key}
            className="remote-cursor"
            data-remote-cursor="true"
            data-remote-cursor-user={cursor.userId || ''}
            data-remote-cursor-x={cursor.x}
            data-remote-cursor-y={cursor.y}
            data-leaving={cursor.leaving ? 'true' : 'false'}
            style={{
              left: `${at.left}%`,
              top: `${at.top}%`,
              '--remote-cursor-fill': color.fill,
              '--remote-cursor-line': color.line,
              '--remote-cursor-ink': USER_INITIALS_INK,
            }}
          >
            <svg className="remote-cursor__arrow" width="16" height="18" viewBox="0 0 16 18" focusable="false">
              <path d="M1.6 1.4 L1.6 14.6 L5.3 11.1 L7.9 16.6 L10.5 15.4 L7.9 10 L13 10 Z" />
            </svg>
            <span className="remote-cursor__label">{cursorLabel(cursor.name)}</span>
          </div>
        );
      })}
    </div>
  );
}
