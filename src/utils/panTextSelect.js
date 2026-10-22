// Pan tool over PDF text (owner 2026-10-14, Drawboard parity).
// ----------------------------------------------------------------------------
// Drawboard's Pan tool is its Text Select tool with one switch: it starts in
// "pan" and turns into "select text" while the mouse or pen RESTS on a line of
// text for 200 ms (appIndex TextSelect.jsx: onPointerEnterTextRect -> 200 ms
// timer -> isTextSelectMode; leaving the text turns it off again). Measured
// live (scratchpad panText/evidence/db-pantext*.json):
//   - over text: grab hand at 80 ms, I-beam after the 200 ms rest;
//   - a press-drag that starts on text BEFORE the rest pans; after it, selects;
//   - a drag that starts on blank page always pans;
//   - double-click = a word, triple-click = a line; a click on text clears;
//   - a finger always pans (no hover), a pen behaves like the mouse.
// Space held is a pure pan (never text). This file is the pure part of that
// rule so it can be unit-tested; PdfjsViewerContainer wires it to the DOM.
// ----------------------------------------------------------------------------

/** How long the pointer must rest on text before Pan selects text (Drawboard: 200 ms). */
export const PAN_TEXT_HOVER_MS = 200;

/**
 * pdf.js draws one tight box per text run, so moving along a line crosses
 * small gaps between boxes. Leaving text counts only after this long off it,
 * so the I-beam (and the rest timer) survive a word gap (Bugbot #832).
 */
export const PAN_TEXT_LEAVE_GRACE_MS = 150;

/** A click shorter than this (px) on the blank page clears a text selection. */
export const PAN_TEXT_CLICK_SLOP_PX = 4;

/**
 * States: 'off' (grab hand, press pans), 'on' (I-beam, a press on text selects),
 * 'keep' (a text selection made under Pan is still live: the text stays
 * selectable so the browser does not drop that selection, but presses pan).
 */
export const PAN_TEXT_STATES = Object.freeze(['off', 'on', 'keep']);

/** Is this pointer one that can rest over text (mouse / pen; never a finger)? */
export function isHoverPointer(pointerType) {
  return pointerType === 'mouse' || pointerType === 'pen';
}

/**
 * Should the viewer mount the (non-interactive) text layer under Pan so text
 * can be found under the pointer? Only where a pointer can hover: a phone or a
 * finger-only iPad never pays for the text layer under Pan.
 */
export function shouldMountPanTextLayer({ toolIsPan, canHover }) {
  return Boolean(toolIsPan && canHover);
}

let hoverQuery = null;
/** True when the device has any pointer that can hover (mouse, trackpad, hover pen). */
export function deviceCanHover(win = typeof window !== 'undefined' ? window : null) {
  try {
    if (!win?.matchMedia) return false;
    // One MediaQueryList, read live: the viewer asks on every render.
    if (!hoverQuery || hoverQuery.win !== win) hoverQuery = { win, list: win.matchMedia('(any-hover: hover)') };
    return Boolean(hoverQuery.list?.matches);
  } catch {
    return false;
  }
}

/** Tools whose PDF text selection feeds the text quick menu (Copy, Highlight...). */
export function isTextSelectionCaptureTool(tool) {
  return tool === 'text-select' || tool === 'pan';
}

/**
 * What a hover move does to the state.
 * @returns {{ state: string, startTimer: boolean, stopTimer: boolean }}
 */
export function resolvePanTextHover({
  toolIsPan, spaceHeld, pointerType, buttons = 0, overText, state = 'off', selectionLive = false,
}) {
  const rest = selectionLive ? 'keep' : 'off';
  if (!toolIsPan || spaceHeld || !isHoverPointer(pointerType)) {
    return { state: state === 'on' ? rest : state, startTimer: false, stopTimer: true };
  }
  // Mid-drag (a text drag or a pan) nothing changes.
  if (buttons !== 0) return { state, startTimer: false, stopTimer: false };
  if (overText) {
    if (state === 'on') return { state, startTimer: false, stopTimer: false };
    return { state, startTimer: true, stopTimer: false };
  }
  return { state: state === 'on' ? rest : state, startTimer: false, stopTimer: true };
}

/**
 * Does a press belong to native text selection instead of the pan?
 * Only a left mouse / pen press on the text layer while the I-beam is showing.
 */
export function panTextOwnsPress({
  toolIsPan, spaceHeld, state, pointerType, button, onTextLayer,
}) {
  return Boolean(toolIsPan && !spaceHeld && state === 'on'
    && isHoverPointer(pointerType) && button === 0 && onTextLayer);
}

/** After a selection change: a live Pan selection keeps the text selectable. */
export function resolvePanTextSelectionChange({ state, selectionLive }) {
  if (state === 'keep' && !selectionLive) return 'off';
  return state;
}

/**
 * Does the mark under the pointer take the hover from the PDF text beneath it?
 * Owner 2026-10-22: under Pan a mark lying over text is what the pointer is
 * on, so it shows the halo and the grab hand (a click picks it), never the
 * I-beam; the I-beam shows only where no mark covers the text. A text markup
 * (highlight, underline, strikeout...) lies on its own text and keeps it.
 * `hit` is annotationHitTest's resolveAnnotationAt result; `mark` is the
 * page object it names (annotation hits only).
 */
export function markTakesPanTextHover(hit, mark = null) {
  if (!hit) return false;
  if (hit.kind === 'callout' || hit.kind === 'counter' || hit.kind === 'group') return true;
  if (hit.kind !== 'annotation') return false;
  return mark?.data?.type !== 'text-markup';
}

/** Is a DOM node one of the text layer's glyph boxes (not an image stand-in)? */
export function isPanTextTarget(target) {
  const node = target?.nodeType === 3 ? target.parentElement : target;
  const span = node?.closest?.('.pdfjsTextLayer span, .pdfjsTextLayer br');
  if (!span) return false;
  return span.getAttribute?.('role') !== 'img' && !span.classList?.contains?.('markedContent');
}

/** Is there a non-empty DOM selection inside a PDF text layer? */
export function hasLivePdfTextSelection(selection) {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return false;
  const node = selection.anchorNode;
  const el = node?.nodeType === 3 ? node.parentElement : node;
  return Boolean(el?.closest?.('.pdfjsTextLayer'));
}

/**
 * Is this hover move "off text" in a way that should wait PAN_TEXT_LEAVE_GRACE_MS
 * before it counts (a gap between text boxes), rather than act at once?
 * Only a plain hover (Pan armed, mouse or pen, no button, no Space) waits;
 * anything else applies straight away.
 */
export function panTextLeaveWaits({ toolIsPan, spaceHeld, pointerType, buttons = 0, overText }) {
  return Boolean(toolIsPan && !spaceHeld && isHoverPointer(pointerType) && buttons === 0 && !overText);
}
