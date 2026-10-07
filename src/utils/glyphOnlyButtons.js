/**
 * glyphOnlyButtons.js — marks every button that shows no text.
 *
 * UX 2026-09-23 (owner: "I hate the big square ... make sure you got rid of
 * all those"). A button that is only a glyph or a colour dot — the text
 * editor's tick and cross, X / share / delete, grips, More, colour dots, the
 * rail and header icons — must never paint a grey press box. CSS cannot tell
 * a text button from a glyph button (it cannot see text nodes), and the
 * glyph is often wrapped (a disc <span> around an <svg>), so a selector list
 * kept missing new cases. This marks them instead: any button or
 * role="button" whose visible text is empty gets data-glyph-only, and
 * src/styles/states.css gives that attribute a glyph-tighten press and no
 * plate. It re-checks on DOM changes, batched to one pass per frame.
 */
const SELECTOR = 'button, [role="button"]';

const mark = (el) => {
  const glyphOnly = (el.textContent || '').trim() === '';
  if (glyphOnly) {
    if (!el.hasAttribute('data-glyph-only')) el.setAttribute('data-glyph-only', '');
  } else if (el.hasAttribute('data-glyph-only')) {
    el.removeAttribute('data-glyph-only');
  }
};

export function installGlyphOnlyButtons(root = typeof document !== 'undefined' ? document.body : null) {
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  let frame = 0;
  const pending = new Set();
  const flush = () => {
    frame = 0;
    pending.forEach((node) => {
      if (!(node instanceof Element) || !node.isConnected) return;
      if (node.matches(SELECTOR)) mark(node);
      node.querySelectorAll?.(SELECTOR).forEach(mark);
      const owner = node.closest?.(SELECTOR);
      if (owner) mark(owner);
    });
    pending.clear();
  };
  const queue = (node) => {
    const el = node instanceof Element ? node : node?.parentElement;
    if (!el) return;
    pending.add(el);
    if (!frame) frame = requestAnimationFrame(flush);
  };
  root.querySelectorAll(SELECTOR).forEach(mark);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') queue(record.target);
      else {
        record.addedNodes.forEach(queue);
        if (record.removedNodes.length) queue(record.target);
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  // iOS WebKit (Safari and the app's WKWebView) only applies :active to a
  // touched element when a touchstart listener exists on it or an ancestor.
  // The icon press (states.css section 5: the glyph tightens to 92%) is pure
  // :active, so without this a tap on the phone gave no press at all whenever
  // no other screen happened to have registered one. Passive and empty: it
  // never delays or blocks a scroll.
  const enableActive = () => {};
  const doc = root.ownerDocument || (typeof document !== 'undefined' ? document : null);
  doc?.addEventListener?.('touchstart', enableActive, { passive: true });
  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    doc?.removeEventListener?.('touchstart', enableActive, { passive: true });
  };
}
