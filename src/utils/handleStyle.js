/**
 * Single source of truth for the look of every draggable handle in the app —
 * shape resize handles, rotation handles, callout knee / arrow / textbox
 * handles, line endpoint handles, and region editor handles.
 *
 * Handles are painted by three different rendering surfaces: SVG elements,
 * plain HTML/CSS boxes (region tool), and Fabric.js canvas controls. Each
 * surface needs its own draw call — a handle drawn for one surface can't be
 * reused on another — but they ALL read their colours from the constants
 * here. That keeps every handle visually identical and means the look can
 * only ever be changed in one place (user request 2026-05-18: unify the
 * three handle styles into one white-fill / blue-ring look).
 *
 * The canonical look is the one the counter-pin / polygon tools already had:
 * a white centre with a blue ring.
 */

// White centre, shared by every handle.
export const HANDLE_FILL = '#ffffff';

// Normal ring colour — Drawboard-style blue. Matches the selection accent in
// theme.js and the line-endpoint handles that already used it.
export const HANDLE_RING = '#4a90e2';

// Ring colour shown while a callout handle is being dragged to a spot that
// would be rejected on release. A live "this won't be accepted" warning so
// the user sees the problem during the drag, not as a surprise on mouse-up.
export const HANDLE_RING_INVALID = '#ef4444';

// Ring thickness for SVG handles (px). Drawn with non-scaling-stroke so it
// stays visually constant across zoom.
export const HANDLE_RING_WIDTH = 1.5;
