/**
 * Animated loadouts (w47, 2026-09-26).
 *
 * RULED 2026-09-26 owner: fixed centred groups + animated loadouts. Owner:
 * "As I switch between the annotation tools and the Select tool, the loadouts
 * on the right, I want those to get animated in and out... a quick
 * animation." The "loadout" is the set of tools right of the Draw / Shapes /
 * Text icons (pen / highlighter / eraser, the shapes, text box / callout,
 * Select's Box / Lasso / Text, a picked mark's group tools), and — with the
 * same motion — the settings in the formatting row (row 2).
 *
 * Intended UX: when the loadout CHANGES (a different set of controls, not a
 * different lit one or a new colour value), the controls that changed fade
 * out while sliding 6px back toward the group icons, and their replacements
 * fade in sliding 6px out of them — a quick crossfade: 120ms out (ease-in),
 * 150ms in (ease-out) starting 40ms later, done by ~190ms; the same family as
 * the rest of the chrome's 140ms motion. Controls that are the SAME at the
 * front of the row (the colours and width when you switch Line → Arrow, the
 * rule before a group's tools) do not animate at all: they are the same
 * controls in the same place, so they just stay.
 *
 * Nothing moves or resizes around it: the outgoing controls are a lifeless
 * copy drawn in a layer laid exactly over the slot (absolutely placed, no
 * pointer, no hooks any selector could find, hidden from assistive tech), and
 * the incoming ones are animated with the `translate` property, which neither
 * lays anything out nor fights the slot's own `transform: translateY(-50%)`.
 * With prefers-reduced-motion on, the swap is instant (no copy, no
 * animation). Reference behaviour matched: the contextual tool bars in Figma
 * and Goodnotes, which crossfade a changed set in place rather than sliding
 * the bar around.
 *
 * Who fills the slot does not matter (the viewer draws a group's tools into
 * the tool bar through a portal, in a render of its own): a MutationObserver
 * watches the slot and compares a signature of its controls, and a copy of
 * the slot is kept after every change, so the outgoing copy is always what
 * was on screen.
 */

export const LOADOUT_MOTION = Object.freeze({
  // The old set is mostly gone before the new one is mostly there, so the two
  // sets' icons (drawn at the same spot) never read as one jumbled row: out
  // over 120ms, in over 150ms starting 40ms later — the whole swap done by
  // ~190ms.
  outMs: 120,
  inMs: 150,
  inDelayMs: 40,
  // Row 2's own fade out (useLeavingRow) — how long a leaving row stays drawn.
  rowOutMs: 140,
  slidePx: 6,
  arriveEasing: 'cubic-bezier(0.33, 1, 0.68, 1)', // ease-out: settles
  leaveEasing: 'cubic-bezier(0.4, 0, 1, 1)', // ease-in: speeds away
});

/** Keyframes for controls arriving (`in`) or leaving (`out`). Both move along
 * the slot's grow direction: out of the group icons, back into them. */
export function loadoutKeyframes(kind, { slidePx = LOADOUT_MOTION.slidePx } = {}) {
  const tucked = { opacity: 0, translate: `${-slidePx}px 0` };
  const shown = { opacity: 1, translate: '0 0' };
  return kind === 'in' ? [tucked, shown] : [shown, tucked];
}

export function prefersReducedMotion(win = typeof window === 'undefined' ? undefined : window) {
  try {
    return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  } catch {
    return false;
  }
}

// A popover or menu opened from the slot is not part of the loadout.
const OUTSIDE_LOADOUT = '[role="dialog"], [role="menu"], [role="listbox"], [data-loadout-ignore]';
const CONTROLS = 'button, input, select, textarea, [data-toolbar-slot], .chrome-divider';
const isControl = (element) => typeof element.matches === 'function'
  ? element.matches(CONTROLS)
  : (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)
    || element.getAttribute?.('data-toolbar-slot') != null
    || String(element.getAttribute?.('class') || '').split(' ').includes('chrome-divider'));

/** A label with its value cut off: "Custom colour #ff0000" and "Width 2 pt"
 * name the same control whatever the value. */
const stableLabel = (label) => String(label || '').replace(/[#\d].*$/, '').trim();

const token = (element) => [
  element.tagName,
  element.getAttribute('data-toolbar-slot') || '',
  stableLabel(element.getAttribute('aria-label')),
].join(':');

/**
 * What the slot holds, as a string: its controls in order, each by tag, slot
 * id and value-free label. Equal signatures mean "the same loadout" (a
 * different tool lit, a new colour picked); a different one means the set
 * itself changed and the swap animates.
 */
export function loadoutSignature(root) {
  if (!root?.querySelectorAll) return '';
  const tokens = [];
  for (const element of root.querySelectorAll(CONTROLS)) {
    if (element.closest?.(OUTSIDE_LOADOUT)) continue;
    tokens.push(token(element));
  }
  return tokens.join('|');
}

// Boxes that only group the controls in a row: looked through, so each
// control inside animates (or stays) on its own.
const WRAPPER = /^(data-toolbar-settings-row|data-chrome-subtools-host|data-chrome-strip|data-select-mode-toggle)$/;
const isWrapper = (element) => [...(element.attributes || [])].some((a) => WRAPPER.test(a.name));

/** The slot's controls as the eye reads them, left to right: its children,
 * looking through wrapper boxes. Popovers are skipped. */
export function loadoutUnits(slot) {
  const units = [];
  const visit = (element) => {
    for (const child of element.children || []) {
      if (child.getAttribute?.('data-loadout-ghost') != null) continue;
      if (child.closest?.(OUTSIDE_LOADOUT)) continue;
      if (isWrapper(child)) visit(child);
      else units.push(child);
    }
  };
  visit(slot);
  return units;
}

const unitSignature = (unit) => `${isControl(unit) ? token(unit) : unit.tagName}>${loadoutSignature(unit)}`;

/** How many controls at the front of the row are unchanged. */
export function sharedPrefix(before, after) {
  let k = 0;
  while (k < before.length && k < after.length && unitSignature(before[k]) === unitSignature(after[k])) k += 1;
  return k;
}

/**
 * Turn a copy of the slot into a lifeless ghost: no ids, data hooks, roles or
 * labels (so no selector — the app's own or a test's — finds it instead of
 * the live one), no pointer, no focus, hidden from assistive tech.
 */
export function makeGhost(copy) {
  const all = [copy, ...(copy.querySelectorAll ? copy.querySelectorAll('*') : [])];
  for (const element of all) {
    for (const attribute of [...(element.attributes || [])]) {
      const { name } = attribute;
      if (name === 'id' || name === 'role' || name === 'title' || name === 'name' || name === 'for'
        || name === 'tabindex' || name.startsWith('data-') || name.startsWith('aria-')) {
        element.removeAttribute(name);
      }
    }
  }
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute('inert', '');
  copy.setAttribute('data-loadout-ghost', 'true');
  if (copy.style) copy.style.pointerEvents = 'none';
  return copy;
}

/** On screen: laid out and not hidden. */
function isShown(element, win) {
  if (!element?.isConnected || !element.getClientRects?.().length) return false;
  try {
    return win?.getComputedStyle?.(element)?.visibility !== 'hidden';
  } catch {
    return true;
  }
}

/**
 * Watch `slot` and animate each change of loadout. `layer` is an empty box
 * laid exactly where the slot's own positioning context is (the ghost copy
 * keeps the slot's inline position, so it lands on top of the old set).
 * Returns a disconnect function.
 *
 *   - a new set: the changed controls crossfade; the shared front stays put;
 *   - the slot hidden (row 2 leaving): its last set is held in the ghost
 *     while the row itself fades (no second fade on top);
 *   - the slot shown again: nothing here (row 2's own fade covers it) — and a
 *     ghost still on screen is dropped;
 *   - the set that is leaving comes straight back (Shapes → Pan → Shapes):
 *     the ghost is dropped and the live set eases back in from where the
 *     ghost had got to, instead of fading out a copy of itself.
 *
 * `options.win` (tests) stands in for window: MutationObserver, matchMedia,
 * getComputedStyle.
 */
export function attachLoadoutTransition(slot, layer, { win = typeof window === 'undefined' ? undefined : window, motion = LOADOUT_MOTION } = {}) {
  if (!slot || !layer || !win?.MutationObserver) return () => {};
  let signature = loadoutSignature(slot);
  let snapshot = slot.cloneNode(true);
  let wasShown = isShown(slot, win);
  let ghost = null;
  let ghostSignature = null;
  const arriving = new Map();

  const dropGhost = () => {
    if (ghost?.parentNode) ghost.parentNode.removeChild(ghost);
    ghost = null;
    ghostSignature = null;
  };

  const leave = (outgoing, before, keep, { hold = false } = {}) => {
    if (ghost) return false; // In a burst, the first set out is the one the eye saw.
    const outgoingUnits = loadoutUnits(outgoing);
    if (outgoingUnits.length <= keep) return false; // nothing of it changed
    // The unchanged front stays live on screen; its copy only holds places.
    for (const unit of outgoingUnits.slice(0, keep)) {
      if (unit.style) unit.style.visibility = 'hidden';
    }
    ghost = makeGhost(outgoing);
    ghostSignature = before;
    layer.appendChild(ghost);
    const animation = ghost.animate?.(
      hold ? [{ opacity: 1 }, { opacity: 1 }] : loadoutKeyframes('out', motion),
      { duration: hold ? motion.rowOutMs : motion.outMs, easing: motion.leaveEasing, fill: 'forwards' },
    );
    const mine = ghost;
    const done = () => { if (ghost === mine) dropGhost(); else mine.remove?.(); };
    if (animation) { animation.onfinish = done; animation.oncancel = done; } else done();
    return true;
  };

  const arrive = (units, { delay = 0, from = null } = {}) => {
    for (const unit of units) {
      arriving.get(unit)?.cancel?.();
      const frames = loadoutKeyframes('in', motion);
      if (from) frames[0] = from;
      const animation = unit.animate?.(frames, {
        duration: from ? Math.max(60, motion.inMs * (1 - Number(from.opacity || 0))) : motion.inMs,
        easing: motion.arriveEasing,
        delay,
        fill: 'backwards',
      });
      if (!animation) continue;
      arriving.set(unit, animation);
      animation.onfinish = () => { if (arriving.get(unit) === animation) arriving.delete(unit); };
    }
  };

  const observer = new win.MutationObserver(() => {
    const next = loadoutSignature(slot);
    const shown = isShown(slot, win);
    if (!prefersReducedMotion(win)) {
      if (wasShown && !shown) {
        leave(snapshot, signature, 0, { hold: true });
      } else if (!wasShown && shown) {
        dropGhost();
      } else if (shown && next !== signature) {
        const liveUnits = loadoutUnits(slot);
        if (ghost && next === ghostSignature) {
          // It came straight back: ease in from where the ghost had got to.
          let from = null;
          try {
            const style = win.getComputedStyle(ghost);
            const opacity = Number(style.opacity);
            if (Number.isFinite(opacity)) {
              from = { opacity, translate: style.translate && style.translate !== 'none' ? style.translate : '0 0' };
            }
          } catch { /* start from tucked */ }
          dropGhost();
          arrive(liveUnits, { from });
        } else {
          const keep = sharedPrefix(loadoutUnits(snapshot), liveUnits);
          const left = leave(snapshot, signature, keep) || Boolean(ghost);
          arrive(liveUnits.slice(keep), { delay: left ? motion.inDelayMs : 0 });
        }
      }
    }
    signature = next;
    wasShown = shown;
    snapshot = slot.cloneNode(true);
  });
  observer.observe(slot, { childList: true, subtree: true, attributes: true, characterData: true });

  return () => {
    observer.disconnect();
    for (const animation of arriving.values()) animation.cancel?.();
    arriving.clear();
    dropGhost();
  };
}
