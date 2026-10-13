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
 * RULED 2026-09-28 owner: one motion for row 2 (in-place crossfade), row 3
 * drops down. Owner: row 2 was inconsistent — "sometimes you get a pan-in
 * animation, sometimes some type of morph" (the w48 re-centre glide, and the
 * w49 per-control grow / shrink, picked differently switch to switch). So
 * everything above is now the TOOL BAR's (row 1's) alone. Row 2 has one rule,
 * every time (attachRowCrossfade below): when its set of controls changes the
 * whole row crossfades in place — the old row fades out (90ms) while the new
 * one fades in (140ms) already at its final centred spot; nothing
 * moves sideways, and an unchanged set never animates. Row 3 (the Aa bar)
 * just drops down from under row 2 (useDropInRow).
 *
 * RULED 2026-09-28 owner: row 2 downward swap (w51). The plain fade read as
 * too plain. Row 2 keeps one rule, but the swap now flows DOWN, the way the
 * rows drop from under the bar above: the old row sinks a few px as it fades
 * out, the new one comes down from a few px above into its final centred
 * spot, starting a beat later so the two overlap as one motion (ROW_MOTION).
 *
 * Who fills the slot does not matter (the viewer draws a group's tools into
 * the tool bar through a portal, in a render of its own): a MutationObserver
 * watches the slot and compares a signature of its controls, and a copy of
 * the slot is kept after every change, so the outgoing copy is always what
 * was on screen.
 */
import {
  cubicBezier, frameAsPolylines, isMorphableIcon, mixColour, morphFrame, morphPairsToWarm, planMorph,
} from './iconMorph.js';

const EASE_IN_OUT = [0.45, 0, 0.55, 1];

export const LOADOUT_MOTION = Object.freeze({
  // One duration and one easing for every morph, grow, shrink and glide.
  durationMs: 200,
  easing: `cubic-bezier(${EASE_IN_OUT.join(', ')})`,
  // Grow in from / shrink out to this size, about the control's own centre.
  growFrom: 0.6,
});

/**
 * RULED 2026-09-28 owner: row 2 downward swap (w51, was w50's in-place
 * opacity crossfade). Row 2's one motion, every time its set of controls
 * changes: the old row moves DOWN outTravelPx while it fades out (ease-in:
 * it speeds away), and the new row comes DOWN from inTravelPx above to its
 * final spot while it fades in (ease-out: it settles), starting inDelayMs
 * after the old one — one continuous downward flow, ~185ms end to end, quick
 * enough that the eye reads a change, not a transition. Both are clipped to
 * row 2's own band (rowSwapKeyframes), so nothing draws over the tool bar or
 * the page. No sideways motion and no scale: the row is centred by measuring
 * its drawn width (useResponsiveToolbar) and a scaled row landed ~2px off
 * (w50); a vertical move leaves the width true.
 * Row 2 leaving moves its held set down by outTravelPx while the row fades
 * (useLeavingRow, outMs/outEasing); appearing, it drops in like row 3
 * (.chrome-row-drop-in in styles.css mirrors DROP_ROW_MOTION).
 * Reference behaviour matched: iOS / Figma contextual bars, whose contents
 * swap with a short vertical slide-and-fade rather than sliding sideways.
 */
export const ROW_MOTION = Object.freeze({
  outMs: 120,
  inMs: 150,
  inDelayMs: 35,
  outTravelPx: 7,
  inTravelPx: 6,
  outEasing: 'cubic-bezier(0.32, 0, 0.67, 0)', // ease-in: speeds away
  inEasing: 'cubic-bezier(0.33, 1, 0.68, 1)', // ease-out: settles
});

/**
 * RULED 2026-09-28 owner: row 3 "doesn't really need an animation, it just
 * needs to appear, e.g. come down from underneath the second bar". It drops
 * 8px down into place while it fades in, and goes back up the same way,
 * quicker. Clipped at its own top edge the whole way, so it never draws over
 * row 2 (or the tool bar) — it comes out from under it.
 */
export const DROP_ROW_MOTION = Object.freeze({
  inMs: 150,
  outMs: 110,
  travelPx: 8,
  inEasing: 'cubic-bezier(0.33, 1, 0.68, 1)', // ease-out
  outEasing: 'cubic-bezier(0.32, 0, 0.67, 0)', // ease-in
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
const WRAPPER = /^(data-toolbar-settings-row|data-chrome-subtools-host|data-chrome-strip|data-select-mode-toggle|data-area-tools)$/;
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
 * A button glyph's colour, as a track: { from, to, start, ms }. A button
 * whose lit state just changed is still easing its colour (.btn's 100ms
 * colour transition): `from` is where that started, `to` where it settles,
 * `start` when (document timeline). With no transition running, from = to.
 */
function colourTrack(button, win, at = 0) {
  const glyph = glyphOf(button);
  if (!glyph) return null;
  for (const element of [button, glyph]) {
    try {
      for (const animation of element.getAnimations?.() || []) {
        if (animation.transitionProperty !== 'color') continue;
        const frames = animation.effect?.getKeyframes?.();
        const to = frames?.[frames.length - 1]?.color;
        if (!to) continue;
        const ms = Number(animation.effect?.getTiming?.().duration) || 100;
        // A transition that has only just been created has no start time yet
        // (it starts on the next frame): count it from now.
        const started = animation.startTime == null ? at : Number(animation.startTime);
        return { from: frames[0]?.color || to, to, start: Number.isFinite(started) ? started : at, ms };
      }
    } catch { /* read it as drawn */ }
  }
  let drawn = null;
  try { drawn = win.getComputedStyle?.(glyph)?.color || null; } catch { /* none */ }
  return drawn ? { from: drawn, to: drawn, start: 0, ms: 1 } : null;
}

/** The colour a track shows at document-timeline time `at`. */
function colourAt(track, at) {
  if (!track) return null;
  if (track.from === track.to) return track.to;
  return mixColour(track.from, track.to, Math.min(1, Math.max(0, (at - track.start) / track.ms)));
}

/** The colour a button's glyph settles on. */
const settledColour = (button, win) => colourTrack(button, win)?.to || null;

// Plans for every morph a switch can ask for, worked out while the page is
// idle so the first switch does not pay for them (once per page).
let warmed = false;
function warmMorphPlans(win) {
  if (warmed) return;
  warmed = true;
  const queue = morphPairsToWarm();
  const later = (fn) => (win.requestIdleCallback ? win.requestIdleCallback(fn, { timeout: 2000 }) : win.setTimeout?.(fn, 50));
  const step = () => {
    const pair = queue.shift();
    if (!pair) return;
    try { planMorph(pair[0], pair[1]); } catch { /* planned on demand instead */ }
    later(step);
  };
  later(step);
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

  const timelineNow = () => {
    const t = win.document?.timeline?.currentTime;
    return t != null && Number.isFinite(Number(t)) ? Number(t) : now();
  };
  const colourOf = (unit) => colourTrack(buttonOf(unit), win, timelineNow());
  if (win.requestIdleCallback || win.setTimeout) warmMorphPlans(win);
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
  // The overlay's colour runs on its own clock: the lit state can change
  // while the shape is still morphing (a tool clicked mid-morph).
  const currentColour = (run) => mixColour(run.colourFrom, run.colourTo, easeInOut(Math.min(1, Math.max(0, (now() - run.colourStart) / run.colourMs))));
  const refreshColours = () => {
    for (const run of morphs.values()) {
      const to = settledColour(run.button, win);
      if (!to || to === run.colourTo) continue;
      run.colourFrom = currentColour(run);
      run.colourTo = to;
      run.colourStart = now();
      run.colourMs = 100; // the buttons' own colour transition
    }
  };
  const draw = (run, e) => {
    run.e = e;
    const pieces = morphFrame(run.pairs, e);
    pieces.forEach((piece, k) => {
      run.paths[k].setAttribute('d', piece.d);
      if (piece.dash) run.paths[k].setAttribute('stroke-dasharray', piece.dash);
      else run.paths[k].removeAttribute('stroke-dasharray');
    });
    run.svg.style.color = currentColour(run);
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
    colour: currentColour(run),
  });
  /** Shrink a morph's overlay out from the shape it had reached. */
  const shrinkMorph = (run) => {
    endMorph(run, { keepOverlay: true });
    const animation = run.svg.animate?.(loadoutKeyframes('out', { motion }), { duration: motion.durationMs, easing: motion.easing, fill: 'forwards' });
    if (!animation) { run.svg.remove?.(); return; }
    animation.onfinish = () => run.svg.remove?.();
    animation.oncancel = () => run.svg.remove?.();
  };
  const startMorph = (index, unit, from, fromColour, startedAt = now()) => {
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
      svg, paths, pairs, button, size, e: 0, start: startedAt,
      colourFrom: fromColour || toColour, colourTo: toColour || fromColour, colourStart: startedAt, colourMs: motion.durationMs,
      glyphHide: glyph.animate?.([{ opacity: 0 }, { opacity: 0 }], { duration: motion.durationMs * 10, fill: 'forwards' }),
    };
    morphs.get(index)?.svg?.remove?.();
    morphs.set(index, run);
    place(run); // row 1's buttons never move while a morph runs
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
    // Every morph of one switch runs on one clock (planning one can take a
    // few ms the first time; the slots must still land together).
    const at = now();
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
        const from = running ? morphNow(running) : { geometry: previous[i].icon, colour: colourAt(previous[i].colour, timelineNow()) };
        if (running) endMorph(running);
        if (startMorph(i, unit, from.geometry, from.colour, at)) return;
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
    const animation = element.animate?.([{ opacity: 1 }, { opacity: 1 }], { duration: ROW_MOTION.outMs, fill: 'forwards' });
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
    } else if (morphs.size) {
      refreshColours();
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

// An open popover or menu: Radix triggers carry aria-expanded, the colour
// pickers sit in an AnchoredPopover.
const OPEN_FROM_ROW = '[aria-expanded="true"]';
const ANCHORED_POPOVER = '[data-anchored-popover]';

/** True when a popover or menu is open from `row` (or any anchored picker is up). */
export function popoverOpenFrom(row) {
  if (row?.querySelector?.(OPEN_FROM_ROW)) return true;
  if (row?.ownerDocument?.querySelector?.(ANCHORED_POPOVER)) return true;
  return false;
}

// Wide enough to never clip sideways: row 2 is clipped only top and bottom.
const NO_SIDE_CLIP = 4000;

/**
 * The clip that keeps a copy of row 2's settings (or the live settings)
 * inside row 2's band while it is drawn `dy` px below its laid-out spot.
 * `room` is how far the band reaches above / below the settings' own box.
 * clip-path is in the element's own (moved) coordinates, so the clip moves
 * the other way by `dy`.
 */
function bandClip(dy, room) {
  const top = -room.top - dy;
  const bottom = dy - room.bottom;
  return `inset(${top}px ${-NO_SIDE_CLIP}px ${bottom}px ${-NO_SIDE_CLIP}px)`;
}

/**
 * RULED 2026-09-28 owner: row 2 downward swap (w51). Keyframes for row 2's
 * settings:
 *   - `in`: from inTravelPx above, transparent, down to its spot;
 *   - `out`: from where it is drawn (`fromY`, `from` opacity — a swap caught
 *     mid-way starts where the eye saw it) down outTravelPx, fading out;
 *   - `leave`: row 2 going away — its held set moves down outTravelPx at full
 *     opacity while the row itself fades (useLeavingRow).
 * Every frame moves straight down (x is always 0) and carries a clip to row
 * 2's band (`room`: the band's reach above / below the settings' box).
 */
export function rowSwapKeyframes(kind, { from = null, fromY = 0, room = { top: 0, bottom: 0 }, motion = ROW_MOTION } = {}) {
  const frame = (opacity, dy) => ({ opacity, translate: `0px ${dy}px`, clipPath: bandClip(dy, room) });
  if (kind === 'in') return [frame(0, -motion.inTravelPx), frame(1, 0)];
  if (kind === 'leave') return [frame(1, 0), frame(1, motion.outTravelPx)];
  return [frame(from ?? 1, fromY), frame(0, motion.outTravelPx)];
}

/** How far row 2's band reaches above / below `holder`'s laid-out box. */
function bandRoom(holder) {
  try {
    const row = holder.parentElement || holder.parentNode;
    const box = holder.getBoundingClientRect?.();
    const band = row?.getBoundingClientRect?.();
    const top = band.top - box.top;
    const bottom = box.bottom - band.bottom;
    // Negative = the band reaches past the box (the usual case: the settings
    // sit centred in a taller bar). Only a real measurement counts.
    if (Number.isFinite(top) && Number.isFinite(bottom)) return { top: -top, bottom: -bottom };
  } catch { /* no layout: clip at the settings' own box */ }
  return { top: 0, bottom: 0 };
}

/**
 * RULED 2026-09-28 owner: one motion for row 2 (in-place crossfade), row 3
 * drops down; RULED 2026-09-28 owner: row 2 downward swap (w51). Watch row
 * 2's settings holder and, each time its SET of controls changes
 * (loadoutSignature: a value — a colour, a width — never counts), swap the
 * whole row with one downward motion: a lifeless copy of the old row, laid
 * in `layer` exactly where it was drawn, moves down ROW_MOTION.outTravelPx
 * and fades out over ROW_MOTION.outMs, while the live row — already at its
 * final centred spot — comes down from ROW_MOTION.inTravelPx above and fades
 * in over ROW_MOTION.inMs, starting ROW_MOTION.inDelayMs later. Both are
 * clipped to row 2's band. One rule every time — no gliding, no per-control
 * grow or shrink, nothing moving sideways.
 *
 *   - the same set (another tool lit, pen → highlighter with the same
 *     controls, a new colour): nothing animates;
 *   - a change caught mid-way: the half-shown row carries on down from where
 *     it had got to, fading out (the copy of the older row keeps going), and
 *     the new one comes down behind it;
 *   - a popover or menu open from the row: the swap is instant, so the
 *     popover stays anchored to its opener (nothing moves or fades under it);
 *   - the holder hidden (row 2 leaving): its last set is held in the copy and
 *     moves down while the row itself fades (useLeavingRow); shown again: the
 *     copy goes and the row's own drop-in covers it;
 *   - prefers-reduced-motion: instant.
 *
 * Returns a disconnect function. `options.win` (tests) stands in for window.
 */
export function attachRowCrossfade(holder, layer, { win = typeof window === 'undefined' ? undefined : window, motion = ROW_MOTION } = {}) {
  if (!holder || !layer || !win?.MutationObserver) return () => {};
  let signature = loadoutSignature(holder);
  let wasShown = isShown(holder, win);
  let snapshot = holder.cloneNode(true);
  let mostlySeen = snapshot;
  let incoming = null;
  const copies = new Set();

  const removeCopy = (copy) => {
    if (copy.remove) copy.remove(); else copy.parentNode?.removeChild(copy);
    copies.delete(copy);
  };
  const clear = () => {
    incoming?.cancel?.();
    incoming = null;
    for (const copy of [...copies]) removeCopy(copy);
  };
  /** Lay a lifeless copy of the row as it was over the live one and fade it. */
  const fadeCopy = (source, keyframes, duration) => {
    const copy = makeGhost(source);
    layer.appendChild(copy);
    copies.add(copy);
    const animation = copy.animate?.(keyframes, { duration, easing: motion.outEasing, fill: 'forwards' });
    if (!animation) { removeCopy(copy); return; }
    let done = false;
    const finish = () => { if (!done) { done = true; removeCopy(copy); } };
    animation.onfinish = finish;
    animation.oncancel = finish;
  };

  const crossfade = () => {
    if (popoverOpenFrom(holder)) { clear(); return; }
    // How much of the row on screen is showing: all of it, or as far as a
    // swap-in caught mid-way had got (0 while it waits its inDelayMs).
    const shown = incoming ? progressOf(incoming) : 1;
    // The row the eye mostly sees: the old one, unless a fade-in caught
    // mid-way was already more than half shown.
    if (shown >= 0.5) mostlySeen = snapshot;
    incoming?.cancel?.();
    incoming = null;
    // Measured with nothing moving it (the running swap is cancelled above).
    const room = bandRoom(holder);
    // A row caught part-way down carries on from where it was drawn.
    const fromY = -motion.inTravelPx * (1 - shown);
    if (shown > 0.02) fadeCopy(snapshot, rowSwapKeyframes('out', { from: shown, fromY, room, motion }), motion.outMs * shown);
    const animation = holder.animate?.(rowSwapKeyframes('in', { room, motion }), {
      duration: motion.inMs, delay: motion.inDelayMs, easing: motion.inEasing, fill: 'backwards',
    });
    if (!animation) return;
    incoming = animation;
    animation.onfinish = () => { if (incoming === animation) incoming = null; };
  };

  const observer = new win.MutationObserver(() => {
    const next = loadoutSignature(holder);
    const shown = isShown(holder, win);
    if (prefersReducedMotion(win)) {
      clear();
    } else if (wasShown && !shown) {
      // Row 2 leaving: hold its last set while the row fades itself — the set
      // the eye was seeing, not one a crossfade had only just begun to show
      // (a tool switch can change the set a render before the row goes).
      const held = incoming && progressOf(incoming) < 0.5 ? mostlySeen : snapshot;
      clear();
      fadeCopy(held, rowSwapKeyframes('leave', { room: bandRoom(holder), motion }), motion.outMs);
    } else if (!wasShown && shown) {
      clear();
    } else if (shown && next !== signature) {
      // From an empty set (the row coming back, filled a render after it is
      // shown) there is nothing to fade out: the row's own fade brings the
      // settings in.
      if (signature) crossfade(); else clear();
    }
    signature = next;
    wasShown = shown;
    snapshot = holder.cloneNode(true);
  });
  observer.observe(holder, { childList: true, subtree: true, attributes: true, characterData: true });

  return () => {
    observer.disconnect();
    clear();
  };
}

/**
 * RULED 2026-09-28 owner: row 3 drops down. Keyframes for the Aa bar coming
 * down from under row 2 (`in`) or going back up (`out`): it travels
 * DROP_ROW_MOTION.travelPx and fades, and a clip at its own top edge moves
 * with it the other way, so nothing of it ever shows above its slot — it
 * never covers row 2, the tool bar or anything else. Straight down: no
 * sideways part.
 */
export function dropRowKeyframes(kind, { motion = DROP_ROW_MOTION } = {}) {
  const t = motion.travelPx;
  const up = { opacity: 0, translate: `0px ${-t}px`, clipPath: `inset(${t}px 0px 0px 0px)` };
  const down = { opacity: 1, translate: '0px 0px', clipPath: 'inset(0px 0px 0px 0px)' };
  return kind === 'in' ? [up, down] : [down, up];
}

/**
 * RULED 2026-09-28 owner: row 3 drops down. The Aa bar just changed from
 * `last` to `bar` (either may be null). Arriving (`bar`, no `last`): it drops
 * in. Leaving (`last`, no `bar`): React has already taken it out — it still
 * holds its last contents — so a lifeless copy of it goes back up in its
 * `slot`, out of the flow (absolutely placed across the row where the bar
 * was), and nothing below it waits or moves. `previous` (a copy still going
 * up) is dropped at once. Instant (nothing) when disabled or with reduced
 * motion. Returns the leaving copy { copy, animation } or null.
 */
export function playRowDrop(bar, last, slot, {
  enabled = true, previous = null, win = typeof window === 'undefined' ? undefined : window, motion = DROP_ROW_MOTION,
} = {}) {
  previous?.animation?.cancel?.();
  previous?.copy?.remove?.();
  if (!enabled || prefersReducedMotion(win)) return null;
  if (bar && !last) {
    bar.animate?.(dropRowKeyframes('in', { motion }), { duration: motion.inMs, easing: motion.inEasing });
    return null;
  }
  if (bar || !last || !slot?.isConnected || !last.children?.length) return null;
  const copy = makeGhost(last.cloneNode(true));
  Object.assign(copy.style, { position: 'absolute', left: '0px', right: '0px', width: 'auto' });
  slot.appendChild(copy);
  const animation = copy.animate?.(dropRowKeyframes('out', { motion }), {
    duration: motion.outMs, easing: motion.outEasing, fill: 'forwards',
  });
  if (!animation) { copy.remove(); return null; }
  let done = false;
  const finish = () => { if (!done) { done = true; copy.remove(); } };
  animation.onfinish = finish;
  animation.oncancel = finish;
  return { copy, animation };
}

