/**
 * Animated loadouts (w47, 2026-09-26) — morphing icons + one motion language
 * (w49, 2026-09-27).
 *
 * RULED 2026-09-26 owner: fixed centred groups + animated loadouts. Owner:
 * "As I switch between the annotation tools and the Select tool, the loadouts
 * on the right, I want those to get animated in and out... a quick
 * animation." The "loadout" is the set of tools right of the Draw / Shapes /
 * Text icons (pen / highlighter / eraser, the shapes, text box / callout,
 * Select's Box / Lasso / Text, a picked mark's group tools), and — with the
 * same motion — the settings in the formatting row (row 2).
 *
 * RULED 2026-09-27 owner: morphing icons + one motion language. w47 faded the
 * changed controls out and in with a 6px sideways slide. Row 2 is also
 * centred and GLIDES to its new centre (w48), and the two motions fought: a
 * small re-centre (Draw ↔ Shapes, ~10px) read as the slide's left→right, a
 * big one (to or from Text, ~25-35px) read as the glide's opposite way — the
 * owner saw Text animate backwards. The one motion language now, for every
 * group switch, in rows 1, 2 and 3 alike:
 *
 *   - the group icons never move (w47);
 *   - a row re-centres by gliding (w48) — the ONLY sideways motion there is;
 *   - a slot that is in both the old and the new set STAYS where it is: the
 *     same control stays still, and a tool icon that changes MORPHS into the
 *     new one in place (pen → rectangle → text box, ~200ms ease-in-out; see
 *     utils/iconMorph.js);
 *   - a slot only in the new set GROWS in from its own centre (scale 0.6 → 1
 *     and fade in); a slot only in the old set SHRINKS out to its centre; a
 *     slot whose control changes but is no tool icon (a setting in row 2)
 *     shrinks the old one out and grows the new one in at the same spot;
 *   - nothing ever slides sideways on its own;
 *   - every one of these takes the same 200ms with the same ease-in-out.
 *
 * Slots pair up by position: the rule, then slot 1, slot 2… — Draw's pen,
 * Shapes' rectangle, Text's text box and Select's Box are all slot 1.
 *
 * Nothing moves or resizes around it: the outgoing controls are a lifeless
 * copy drawn in a layer laid exactly over the slot (absolutely placed, no
 * pointer, no hooks any selector could find, hidden from assistive tech); a
 * morph is drawn by an overlay SVG in the same layer over the live button,
 * whose own glyph is hidden (by an animation, so the DOM is not touched) until
 * the morph lands on it. Everything else is a Web Animation on `scale` /
 * `opacity`, which lays nothing out. A change caught mid-way carries on from
 * where it had got to (a morph starts from the shape on screen, a control
 * growing in shrinks back from its current size and the reverse), so a quick
 * run of switches never snaps. With prefers-reduced-motion every swap is
 * instant. Reference behaviour matched: morphicons.com (stroke icons that
 * interpolate between shapes, sharp at rest) and the contextual bars in Figma
 * and Goodnotes, which change a set in place rather than sliding the bar.
 *
 * Who fills the slot does not matter (the viewer draws a group's tools into
 * the tool bar through a portal, in a render of its own): a MutationObserver
 * watches the slot and compares a signature of its controls, and a copy of
 * the slot is kept after every change, so the outgoing copy is always what
 * was on screen.
 */
import {
  cubicBezier, frameAsPolylines, isMorphableIcon, mixColour, morphFrame, planMorph,
} from './iconMorph.js';

const EASE_IN_OUT = [0.45, 0, 0.55, 1];

export const LOADOUT_MOTION = Object.freeze({
  // One duration and one easing for every morph, grow, shrink and glide.
  durationMs: 200,
  easing: `cubic-bezier(${EASE_IN_OUT.join(', ')})`,
  // Grow in from / shrink out to this size, about the control's own centre.
  growFrom: 0.6,
  // Row 2's own fade out (useLeavingRow) — how long a leaving row stays drawn.
  rowOutMs: 140,
  leaveEasing: 'cubic-bezier(0.4, 0, 1, 1)', // row 2's fade: ease-in, speeds away
});

const easeInOut = cubicBezier(...EASE_IN_OUT);

/**
 * Keyframes for a control growing in (`in`) or shrinking out (`out`) about
 * its own centre. `from` ({ opacity, scale }) starts it where a change caught
 * mid-way had got to. No `translate`: nothing slides sideways.
 */
export function loadoutKeyframes(kind, { motion = LOADOUT_MOTION, from = null } = {}) {
  const small = { opacity: 0, scale: String(motion.growFrom) };
  const full = { opacity: 1, scale: '1' };
  const start = from ? { opacity: from.opacity, scale: String(from.scale) } : (kind === 'in' ? small : full);
  return kind === 'in' ? [start, full] : [start, small];
}

/**
 * What happens to each slot when a loadout changes. `before` / `after` are
 * the slots in order, each { sig, icon } (icon = the tool glyph's name, when
 * the slot is a tool). Returns one kind per slot:
 *   'stay'   the same control in the same place — nothing animates;
 *   'morph'  a tool icon in both sets — the old icon morphs into the new;
 *   'swap'   another control in both — the old shrinks out, the new grows in;
 *   'grow'   only in the new set; 'shrink' only in the old.
 */
export function planLoadoutSwap(before, after) {
  const kinds = [];
  for (let i = 0; i < Math.max(before.length, after.length); i += 1) {
    const b = before[i];
    const a = after[i];
    if (b && a) {
      if (b.sig === a.sig) kinds.push('stay');
      else if (isMorphableIcon(b.icon) && isMorphableIcon(a.icon)) kinds.push('morph');
      else kinds.push('swap');
    } else kinds.push(a ? 'grow' : 'shrink');
  }
  return kinds;
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


/** The tool glyph a slot shows (its button's data-morph-icon), if any. */
export function morphIconOf(unit) {
  if (!unit) return null;
  const own = unit.getAttribute?.('data-morph-icon');
  if (own) return own;
  const inner = unit.querySelector?.('[data-morph-icon]');
  return inner?.getAttribute?.('data-morph-icon') || null;
}

const buttonOf = (unit) => (unit?.matches?.('button') ? unit : unit?.querySelector?.('button')) || null;
const glyphOf = (button) => button?.querySelector?.('svg, span[aria-hidden="true"]') || null;

/**
 * The colour a button's glyph settles on. A button whose lit state just
 * changed is still easing its colour (.btn's 100ms colour transition), so
 * the computed colour is where it starts; the transition's last keyframe is
 * where it ends.
 */
function settledColour(button, win) {
  const glyph = glyphOf(button);
  if (!glyph) return null;
  for (const element of [button, glyph]) {
    try {
      for (const animation of element.getAnimations?.() || []) {
        if (animation.transitionProperty !== 'color') continue;
        const frames = animation.effect?.getKeyframes?.();
        const colour = frames?.[frames.length - 1]?.color;
        if (colour) return colour;
      }
    } catch { /* read it as drawn */ }
  }
  try { return win.getComputedStyle?.(glyph)?.color || null; } catch { return null; }
}

/** How far through an animation is (eased), 1 when it is over or missing. */
function progressOf(animation) {
  if (!animation || animation.playState === 'finished') return 1;
  try {
    const p = animation.effect?.getComputedTiming?.().progress;
    return Number.isFinite(p) ? p : 0;
  } catch {
    return 0;
  }
}

/** Where a grow / shrink had got to, as { opacity, scale }. */
function growState(kind, animation, motion) {
  const p = progressOf(animation);
  const shown = kind === 'in' ? p : 1 - p;
  return { opacity: shown, scale: motion.growFrom + (1 - motion.growFrom) * shown };
}

/**
 * Watch `slot` and animate each change of loadout (see the top of this file).
 * `layer` is an empty box laid exactly where the slot's own positioning
 * context is (the ghost copy keeps the slot's inline position, so it lands on
 * top of the old set); morph overlays are drawn in it too.
 * Returns a disconnect function.
 *
 *   - a new set: each slot stays, morphs, grows, shrinks or swaps;
 *   - the slot hidden (row 2 leaving): its last set is held in the ghost
 *     while the row itself fades (no second fade on top);
 *   - the slot shown again: nothing here (row 2's own fade covers it) — and a
 *     ghost still on screen is dropped;
 *   - a change caught mid-way carries on from where it had got to.
 *
 * `options.win` (tests) stands in for window: MutationObserver, matchMedia,
 * getComputedStyle, requestAnimationFrame, performance.
 */
export function attachLoadoutTransition(slot, layer, { win = typeof window === 'undefined' ? undefined : window, motion = LOADOUT_MOTION } = {}) {
  if (!slot || !layer || !win?.MutationObserver) return () => {};
  const now = () => win.performance?.now?.() ?? Date.now();
  let signature = loadoutSignature(slot);
  let wasShown = isShown(slot, win);
  let snapshot = null;
  let previous = []; // the live slots at the last snapshot: { element, sig, icon, colour }

  const colourOf = (unit) => settledColour(buttonOf(unit), win);
  const takeSnapshot = () => {
    snapshot = slot.cloneNode(true);
    previous = loadoutUnits(slot).map((element) => ({
      element, sig: unitSignature(element), icon: morphIconOf(element), colour: colourOf(element),
    }));
  };
  takeSnapshot();

  const ghosts = new Set(); // { element, live: count of units still shrinking }
  const arriving = new Map(); // live unit → its grow animation
  const shrinking = new Map(); // slot index → { unit, animation, sig, ghost }
  const morphs = new Map(); // slot index → morph run
  let frame = null;

  const releaseGhost = (ghost) => {
    ghost.live -= 1;
    if (ghost.live <= 0) { ghost.element.remove?.() ?? ghost.element.parentNode?.removeChild(ghost.element); ghosts.delete(ghost); }
  };
  const dropGhosts = () => {
    for (const { element } of ghosts) { if (element.parentNode) element.parentNode.removeChild(element); }
    ghosts.clear();
    shrinking.clear();
  };

  const shrink = (unit, from, ghost, index, sig) => {
    const animation = unit.animate?.(loadoutKeyframes('out', { motion, from }), {
      duration: motion.durationMs * (from ? Math.max(0.3, from.opacity) : 1), easing: motion.easing, fill: 'forwards',
    });
    if (!animation) { if (unit.style) unit.style.visibility = 'hidden'; return; }
    ghost.live += 1;
    const entry = { unit, animation, sig, ghost };
    if (index != null) shrinking.set(index, entry);
    let released = false;
    const done = () => {
      if (released) return;
      released = true;
      if (shrinking.get(index) === entry) shrinking.delete(index);
      releaseGhost(ghost);
    };
    animation.onfinish = done;
    animation.oncancel = done;
  };

  const grow = (unit, from = null) => {
    arriving.get(unit)?.cancel?.();
    const animation = unit.animate?.(loadoutKeyframes('in', { motion, from }), {
      duration: motion.durationMs * (from ? Math.max(0.3, 1 - from.opacity) : 1), easing: motion.easing, fill: 'backwards',
    });
    if (!animation) return;
    arriving.set(unit, animation);
    animation.onfinish = () => { if (arriving.get(unit) === animation) arriving.delete(unit); };
  };

  // ---- Morphs: an overlay SVG over the live button, one frame loop. ----
  const svgNS = 'http://www.w3.org/2000/svg';
  const canMorph = () => typeof layer.ownerDocument?.createElementNS === 'function' && typeof win.requestAnimationFrame === 'function';

  const place = (run) => {
    try {
      const box = layer.getBoundingClientRect();
      const b = run.button.getBoundingClientRect();
      run.svg.style.left = `${b.left + b.width / 2 - run.size / 2 - box.left}px`;
      run.svg.style.top = `${b.top + b.height / 2 - run.size / 2 - box.top}px`;
    } catch { /* keep the last spot */ }
  };
  const draw = (run, e) => {
    run.e = e;
    const pieces = morphFrame(run.pairs, e);
    pieces.forEach((piece, k) => {
      run.paths[k].setAttribute('d', piece.d);
      if (piece.dash) run.paths[k].setAttribute('stroke-dasharray', piece.dash);
      else run.paths[k].removeAttribute('stroke-dasharray');
    });
    run.svg.style.color = mixColour(run.fromColour, run.toColour, e);
    place(run);
  };
  const endMorph = (run, { keepOverlay = false } = {}) => {
    run.glyphHide?.cancel?.();
    if (!keepOverlay) run.svg.remove?.();
    for (const [index, other] of morphs) if (other === run) morphs.delete(index);
  };
  const tick = () => {
    frame = null;
    const t = now();
    for (const run of [...morphs.values()]) {
      const p = Math.min(1, (t - run.start) / motion.durationMs);
      draw(run, easeInOut(p));
      if (p >= 1) endMorph(run);
    }
    if (morphs.size) frame = win.requestAnimationFrame(tick);
  };
  const morphNow = (run) => ({
    geometry: frameAsPolylines(morphFrame(run.pairs, run.e), run.pairs, run.e),
    colour: mixColour(run.fromColour, run.toColour, run.e),
  });
  /** Shrink a morph's overlay out from the shape it had reached. */
  const shrinkMorph = (run) => {
    endMorph(run, { keepOverlay: true });
    const animation = run.svg.animate?.(loadoutKeyframes('out', { motion }), { duration: motion.durationMs, easing: motion.easing, fill: 'forwards' });
    if (!animation) { run.svg.remove?.(); return; }
    animation.onfinish = () => run.svg.remove?.();
    animation.oncancel = () => run.svg.remove?.();
  };
  const startMorph = (index, unit, from, fromColour) => {
    const button = buttonOf(unit);
    const glyph = glyphOf(button);
    const icon = morphIconOf(unit);
    if (!button || !glyph || !canMorph()) return false;
    const size = glyph.getBoundingClientRect?.().width || 16;
    const pairs = planMorph(from, icon, { glyphPx: size });
    if (!pairs) return false;
    // The colour the new glyph settles on (its button's colour transition
    // would otherwise report where it starts, not where it ends).
    const toColour = settledColour(button, win);
    const svg = layer.ownerDocument.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('data-loadout-morph', icon);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.5');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    Object.assign(svg.style, {
      position: 'absolute', width: `${size}px`, height: `${size}px`, overflow: 'visible', pointerEvents: 'none',
    });
    const paths = pairs.map(() => svg.appendChild(layer.ownerDocument.createElementNS(svgNS, 'path')));
    layer.appendChild(svg);
    const run = {
      svg, paths, pairs, button, size, e: 0, start: now(),
      fromColour: fromColour || toColour, toColour: toColour || fromColour,
      glyphHide: glyph.animate?.([{ opacity: 0 }, { opacity: 0 }], { duration: motion.durationMs * 10, fill: 'forwards' }),
    };
    morphs.get(index)?.svg?.remove?.();
    morphs.set(index, run);
    draw(run, 0);
    if (frame == null) frame = win.requestAnimationFrame(tick);
    return true;
  };

  const cancelAll = () => {
    for (const run of [...morphs.values()]) endMorph(run);
    morphs.clear();
    if (frame != null) { win.cancelAnimationFrame?.(frame); frame = null; }
    for (const animation of arriving.values()) animation.cancel?.();
    arriving.clear();
    dropGhosts();
  };

  const swap = () => {
    const beforeUnits = loadoutUnits(snapshot);
    const afterUnits = loadoutUnits(slot);
    const after = afterUnits.map((element) => ({ element, sig: unitSignature(element), icon: morphIconOf(element) }));
    const kinds = planLoadoutSwap(previous, after);
    // Where each old slot was on screen (a change caught mid-way).
    const beforeState = previous.map(({ element }) => (arriving.has(element) ? growState('in', arriving.get(element), motion) : null));

    // The old side: a copy of the old set, showing only what shrinks out.
    const outgoing = kinds.map((kind, i) => i < beforeUnits.length && (kind === 'shrink' || kind === 'swap') && !morphs.has(i));
    let ghost = null;
    if (outgoing.some(Boolean)) {
      ghost = { element: makeGhost(snapshot), live: 0 };
      ghosts.add(ghost);
      layer.appendChild(ghost.element);
    }
    // Morphs caught mid-way whose slot no longer morphs shrink out as drawn.
    for (const [i, run] of [...morphs]) {
      if (kinds[i] === 'morph' || kinds[i] === 'stay') continue;
      shrinkMorph(run);
    }
    if (ghost) {
      beforeUnits.forEach((unit, i) => {
        if (outgoing[i]) shrink(unit, beforeState[i], ghost, i, previous[i]?.sig);
        else if (unit.style) unit.style.visibility = 'hidden';
      });
      if (ghost.live <= 0) { ghost.live = 1; releaseGhost(ghost); }
    }

    // The new side.
    kinds.forEach((kind, i) => {
      const unit = afterUnits[i];
      if (!unit) return;
      if (kind === 'morph') {
        const running = morphs.get(i);
        const from = running ? morphNow(running) : { geometry: previous[i].icon, colour: previous[i].colour };
        if (running) endMorph(running);
        if (startMorph(i, unit, from.geometry, from.colour)) return;
        grow(unit);
        return;
      }
      if (kind === 'grow' || kind === 'swap') {
        // The same control still shrinking out here (Shapes → Pan → Shapes):
        // it turns round and grows back from where it had got to.
        const back = shrinking.get(i);
        if (back && back.sig === after[i].sig && kind === 'grow') {
          const from = growState('out', back.animation, motion);
          back.animation.cancel?.();
          if (back.unit.style) back.unit.style.visibility = 'hidden';
          grow(unit, from);
          return;
        }
        grow(unit);
      }
    });
  };

  const hold = () => {
    const element = makeGhost(snapshot);
    const ghost = { element, live: 1 };
    ghosts.add(ghost);
    layer.appendChild(element);
    const animation = element.animate?.([{ opacity: 1 }, { opacity: 1 }], { duration: motion.rowOutMs, easing: motion.leaveEasing, fill: 'forwards' });
    let released = false;
    const done = () => { if (!released) { released = true; releaseGhost(ghost); } };
    if (animation) { animation.onfinish = done; animation.oncancel = done; } else done();
  };

  const observer = new win.MutationObserver(() => {
    const next = loadoutSignature(slot);
    const shown = isShown(slot, win);
    if (prefersReducedMotion(win)) {
      cancelAll();
    } else if (wasShown && !shown) {
      cancelAll();
      hold();
    } else if (!wasShown && shown) {
      dropGhosts();
    } else if (shown && next !== signature) {
      swap();
    }
    signature = next;
    wasShown = shown;
    takeSnapshot();
  });
  observer.observe(slot, { childList: true, subtree: true, attributes: true, characterData: true });

  return () => {
    observer.disconnect();
    cancelAll();
  };
}

/**
 * RULED 2026-09-27 owner: rows 2/3 centred, animated (w48). Rows 2 and 3 are
 * centred under the group icons again, so a row whose controls change (a
 * tool switch, Cloud adding Bump) re-centres. The owner dislikes snapping, so
 * that move GLIDES: the row is laid out at its new spot at once (nothing else
 * is laid out again) and a Web Animation on the `translate` property carries
 * it there from where the eye last saw it, over ROW_SLIDE_MS with the
 * loadout's ease-out. `translate` composes with the row's own
 * `transform: translateY(-50%)` and lays nothing out. A move that lands
 * mid-glide starts from where the glide had got to, so a quick run of tool
 * switches never jumps.
 *
 * The move is instant (no glide) with prefers-reduced-motion, while the row
 * itself is dropping in or fading out (it arrives in place, never sliding
 * sideways as it appears), and while a popover or menu is open from it (the
 * popover is placed under its opener after each render, so it never trails a
 * gliding opener). A row whose controls have not changed never moves at all
 * (useResponsiveToolbar ignores a pixel of measuring noise).
 *
 * RULED 2026-09-27 owner: morphing icons + one motion language (w49). The
 * glide is the one sideways motion in the bars, and it now keeps the same
 * time and ease-in-out as every morph, grow and shrink (200ms; it was 190ms
 * ease-out). A centred row that gets wider spreads out from the centre and
 * one that gets narrower draws in — the same for every group.
 */
export const ROW_SLIDE_MS = LOADOUT_MOTION.durationMs;

const rowSlides = new WeakMap();

/** How far `element` is drawn from its laid-out spot by a running glide. */
function carriedOffset(element, win) {
  try {
    const x = parseFloat(win?.getComputedStyle?.(element)?.translate);
    return Number.isFinite(x) ? x : 0;
  } catch {
    return 0;
  }
}

/** Stop any glide on `targets`, leaving them at their laid-out spot. */
export function cancelRowSlide(targets) {
  for (const target of targets) {
    rowSlides.get(target)?.cancel?.();
    rowSlides.delete(target);
  }
}

/**
 * Glide `targets` (moved together) from `deltaPx` right of their new spot
 * (negative = left of it) to it. Returns the animations started.
 */
export function slideRow(targets, deltaPx, { win = typeof window === 'undefined' ? undefined : window, motion = LOADOUT_MOTION } = {}) {
  const started = [];
  for (const target of targets) {
    const running = rowSlides.get(target);
    const carried = running ? carriedOffset(target, win) : 0;
    running?.cancel?.();
    rowSlides.delete(target);
    const from = deltaPx + carried;
    if (Math.abs(from) < 0.5) continue;
    const animation = target.animate?.(
      [{ translate: `${from}px 0` }, { translate: '0 0' }],
      { duration: ROW_SLIDE_MS, easing: motion.easing },
    );
    if (!animation) continue;
    rowSlides.set(target, animation);
    animation.onfinish = () => { if (rowSlides.get(target) === animation) rowSlides.delete(target); };
    started.push(animation);
  }
  return started;
}

// An open popover or menu: Radix triggers carry aria-expanded, the colour
// pickers sit in an AnchoredPopover.
const OPEN_FROM_ROW = '[aria-expanded="true"]';
const ANCHORED_POPOVER = '[data-anchored-popover]';

/**
 * True when a move of `row` (the whole bar) should be instant rather than
 * glide: reduced motion, the bar dropping in or fading out, or a popover
 * open from it (or any anchored picker up).
 */
export function rowMoveIsInstant(row, win = typeof window === 'undefined' ? undefined : window) {
  if (prefersReducedMotion(win)) return true;
  try {
    if (row?.getAnimations?.().some((animation) => animation.playState === 'running')) return true;
  } catch { /* no animation API: glide */ }
  if (row?.querySelector?.(OPEN_FROM_ROW)) return true;
  if (row?.ownerDocument?.querySelector?.(ANCHORED_POPOVER)) return true;
  return false;
}
