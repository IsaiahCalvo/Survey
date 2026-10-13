/**
 * Dismiss rules — the ONE answer to "what does a press outside an open thing
 * do?" for the whole app (desktop, phone, canvas chrome, home screens).
 * The full write-up is docs/DISMISS-RULES.md; keep the two in step.
 *
 * Owner ruling 2026-09-23 ("is clicking off just clicking off, or is clicking
 * off actually switching to another tool?"):
 *
 * R1 Light popovers never block. Dropdowns, menus, the colour picker, tool
 *    sub-menus, "…" menus, sort/filter menus: a press outside CLOSES the
 *    popover AND the same press does its normal job — opens the other
 *    dropdown, switches tool, presses the button, selects the annotation that
 *    was pressed, focuses the field. One press, never two.
 * R2 Bare page exception. A press on the PDF viewing area where nothing is
 *    under the pointer (empty page, grey backdrop) while a light popover is
 *    open ONLY closes the popover: no stroke, no shape, no text box, no
 *    Survey Marker, no cleared selection. That press was aimed at the
 *    popover, not the page, and a stray mark is the worst outcome. The Pan
 *    tool is exempt — it never marks, so its drag still pans — and wheel,
 *    trackpad and two-finger gestures are never touched.
 * R3 Typing. While you are typing (the canvas text editor, or a field inside
 *    an open popover or a search box), the first press outside only ends the
 *    typing (commits it) and does nothing else — except controls that act on
 *    the text (formatting bar, colour controls), other popover openers and
 *    text/title fields, and (owner 2026-10-04) the TOOL buttons: a press on a
 *    tool commits the text AND arms that tool in the same press.
 * R4 Blocking windows block. Modal dialogs and sheets with a dimmed backdrop:
 *    a press on the backdrop only closes the window (destructive confirms:
 *    nothing) and never reaches what is behind it. They are NOT registered
 *    here; their backdrop element catches the press.
 * R5 Escape closes only the topmost popover or window.
 * R6 Only one light popover is open at a time: opening one closes the other
 *    in the same press (that falls out of R1 — the press on the second
 *    opener is an outside press for the first).
 *
 * The mechanism: every open light popover registers here (DismissBarrier does
 * it for you; hand-rolled popovers call registerLightPopover). One window
 * capture listener — installed when this module loads, so it runs before
 * every canvas listener — applies R2 and R5 for all of them. R1 is simply
 * "the popover's own outside handler closes it and does NOT consume".
 */

import { isLiveFormWidgetTarget, liveFormWidgetAtPoint } from '../utils/formWidgetPointerTargets.js';

export const elementOf = (target) => (
  target && typeof target.closest === 'function'
    ? target
    : (target?.parentElement || null)
);

/** A field you type into (the caret lives there). */
export const TYPING_SELECTOR = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="color"]):not([type="file"]), textarea, [contenteditable]:not([contenteditable="false"])';

/**
 * R3 exceptions that apply everywhere: a control that opens another popover,
 * or another text field. A press on one of these while typing ends the typing
 * AND works at once. Surfaces add their own (e.g. colour swatches).
 */
export const OPENER_OR_FIELD_SELECTOR = `[aria-haspopup]:not([aria-haspopup="false"]), [data-dismiss-opener], ${TYPING_SELECTOR}`;

/**
 * R3 exception (owner 2026-10-04): "the first click on any tool button while a
 * text box / callout is being edited commits it AND switches to that tool in
 * the same click". Every tool button (Pan, Select and its modes, the group
 * buttons, each group's tools — desktop bar and phone rail) carries
 * `data-tool-switch`. The press is not consumed: the editor's own outside
 * press commits the text and the button's click arms the tool.
 */
export const TOOL_SWITCH_SELECTOR = '[data-tool-switch]';

/**
 * Anything on the PDF viewing area that is NOT bare page: a control, a link,
 * a live form widget, the text editor, or an annotation / Survey Marker /
 * handle (all annotation hit targets live inside the SVG layer and carry one
 * of these attributes). `[data-dismiss-press-through]` is the general opt-out
 * for any future on-page control.
 */
const ON_PAGE_TARGET_SELECTOR = [
  'input', 'textarea', 'select', 'button', 'a[href]', 'label',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]', '[role="menuitem"]', '[role="option"]', '[role="slider"]', '[role="dialog"]', '[role="menu"]',
  '[data-text-edit-overlay]', '[data-pan-interactive="true"]',
  '[data-annotation-index]', '[data-callout-id]', '[data-counter-overlay]', '[data-edit-entry-kind]',
  '.linkAnnotation', '[data-element-id="link"]', '[data-text-markup-link]',
  '[data-dismiss-press-through]',
].join(', ');

/**
 * R2 — is this press on the bare PDF viewing area (nothing under it)?
 *
 * The viewing area is the pdf.js scroller (`[data-mobile-pdf-surface]`, on
 * desktop and phone alike). Inside it, a press is bare when it lands on the
 * page itself (page canvas, text layer, the page box, the grey backdrop) or
 * on the SVG annotation layer's ROOT — every annotation is a child of that
 * root, so the root being the target means "empty page". The Pan tool is
 * exempt (its press pans, it never marks).
 */
export function isBarePagePress(event) {
  const el = elementOf(event?.target);
  if (!el) return false;
  const surface = el.closest('[data-mobile-pdf-surface]');
  if (!surface) return false;
  if (surface.getAttribute('data-interaction-mode') === 'Pan') return false;
  // Space held = a temporary Pan (desktop): same exemption.
  const spacePan = surface.getAttribute('data-space-pan');
  if (spacePan && spacePan !== 'off') return false;
  if (el.closest(ON_PAGE_TARGET_SELECTOR)) return false;
  if (isLiveFormWidgetTarget(el)) return false;
  const svg = el.closest('svg');
  if (svg) {
    const isLayerRoot = el === svg && !svg.parentElement?.closest?.('svg');
    if (!isLayerRoot) return false;
    // The SVG root paints over live form widgets; a press over one is aimed
    // at the widget (R1: focus the field), not at the page.
    if (liveFormWidgetAtPoint(event.clientX, event.clientY)) return false;
  }
  return true;
}

export const consumeEvent = (event) => {
  event.preventDefault?.();
  event.stopPropagation?.();
  event.stopImmediatePropagation?.();
};

/**
 * Swallow the REST of a press this module (or a barrier) already handled:
 * its moves and release for the same pointer, and the trailing click. Used
 * only for R2 (bare page), R3 (ends typing only) and blocking surfaces — never
 * for an ordinary R1 outside press, which must keep its click.
 *
 * Registered on window/capture so it runs before every canvas listener. The
 * pointerdown's own preventDefault already suppresses the compatibility
 * mousedown/mouseup; `click` is always fired, hence the explicit block.
 */
export function swallowRestOfPress(pointerEvent) {
  if (typeof window === 'undefined') return;
  const pointerId = pointerEvent?.pointerId;
  const trackPointer = pointerEvent?.type === 'pointerdown';
  // The trailing click comes right after the release. The window for it opens
  // at release, not at the press, so a press held for seconds still has its
  // click swallowed, and a drag (which never clicks) does not leave a blocker
  // behind to eat the next, unrelated tap.
  const CLICK_WINDOW_MS = 300;
  let timeoutId = 0;
  const releasePointer = () => {
    window.removeEventListener('pointermove', onPointerRest, true);
    window.removeEventListener('pointerup', onPointerRest, true);
    window.removeEventListener('pointercancel', onPointerRest, true);
  };
  const cleanup = () => {
    releasePointer();
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('dblclick', onClick, true);
    window.clearTimeout(timeoutId);
  };
  const openClickWindow = () => {
    window.addEventListener('click', onClick, true);
    window.addEventListener('dblclick', onClick, true);
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(cleanup, CLICK_WINDOW_MS);
  };
  function onPointerRest(event) {
    if (pointerId != null && event.pointerId != null && event.pointerId !== pointerId) return;
    consumeEvent(event);
    if (event.type === 'pointermove') return;
    releasePointer();
    if (event.type === 'pointerup') openClickWindow();
    else cleanup(); // pointercancel: no click follows
  }
  function onClick(event) {
    consumeEvent(event);
    cleanup();
  }
  if (trackPointer) {
    // Blocks until the pointer is released — no timer.
    window.addEventListener('pointermove', onPointerRest, true);
    window.addEventListener('pointerup', onPointerRest, true);
    window.addEventListener('pointercancel', onPointerRest, true);
  } else {
    // Called for a click (or a press with no pointer stream): only the
    // trailing click is left.
    openClickWindow();
  }
}

/* ------------------------------------------------------------- registry */

const openPopovers = [];

/**
 * Register an OPEN light popover (or a typing surface). Returns the unregister
 * function. Entries stack in the order they open; the last one is topmost.
 *
 * @param {object} entry
 * @param {(event: Event, reason: 'bare-page' | 'escape' | 'typing-ended') => void} entry.close
 * @param {(target: Element) => boolean} [entry.contains] — the surface's own
 *   area (a press there is not "outside").
 * @param {() => Element | null} [entry.typingField] — the field you are typing
 *   in, if any (R3).
 * @param {(event: Event) => void} [entry.endTyping] — end the typing (commit);
 *   defaults to blurring typingField().
 * @param {(target: Element) => boolean} [entry.passes] — R3 exceptions of this
 *   surface: controls that act on the text, which keep working while you type.
 * @param {boolean} [entry.escape=true] — false when the surface owns Escape.
 * @param {'popover' | 'typing'} [entry.kind='popover'] — a 'typing' surface (the
 *   text editor, a search box) takes part in R3 and R5 only; the R2 bare-page
 *   guard is for open popovers.
 */
export function registerLightPopover(entry) {
  const record = { escape: true, ...entry };
  openPopovers.push(record);
  return () => {
    const index = openPopovers.indexOf(record);
    if (index !== -1) openPopovers.splice(index, 1);
  };
}

/**
 * The whole contract for a hand-rolled light popover in one call: an outside
 * press closes it and keeps going (R1 — pointerdown on document/capture, so a
 * control that stops propagation cannot keep it open, and the press is never
 * consumed), and it is registered for R2 (bare page) and R5 (Escape). Returns
 * the cleanup. `contains(target)` is the popover's own area, trigger included.
 */
export function watchLightPopover({ contains, close, escape = true }) {
  if (typeof document === 'undefined') return () => {};
  const inside = (target) => {
    const element = elementOf(target);
    try { return Boolean(element && contains(element)); } catch { return false; }
  };
  const onDown = (event) => {
    if (!inside(event.target)) close(event, 'outside');
  };
  document.addEventListener('pointerdown', onDown, true);
  const unregister = registerLightPopover({ close, contains: inside, escape });
  return () => {
    document.removeEventListener('pointerdown', onDown, true);
    unregister();
  };
}

export const hasOpenLightPopover = () => openPopovers.length > 0;

// The control the latest primary press landed on. A popover that opens right
// after it treats that control as its OPENER: pressing it again only closes
// the popover (a toggle), instead of closing it and reopening it on the click.
let lastPress = { control: null, at: 0 };
const OPENER_CONTROL_SELECTOR = 'button, [role="button"], [aria-haspopup], a[href], summary';

/** The control a primary press landed on within the last second, if any. */
export function recentPressedControl() {
  if (!lastPress.control || Date.now() - lastPress.at > 1000) return null;
  return lastPress.control.isConnected === false ? null : lastPress.control;
}

const safeContains = (entry, target) => {
  try { return Boolean(entry.contains?.(target)); } catch { return false; }
};

/**
 * R3 — the topmost surface you are typing in, when this press should ONLY end
 * the typing: it lands outside that surface, outside every other open popover
 * (a menu opened while typing belongs to the typing), and not on an exception
 * (another popover opener, another text field, or a control of the surface's
 * own that acts on the text).
 */
function typingPressToEnd(target) {
  for (let i = openPopovers.length - 1; i >= 0; i -= 1) {
    const entry = openPopovers[i];
    const field = entry.typingField?.();
    if (!field) continue;
    if (!target) return null;
    if (safeContains(entry, target)) return null;
    if (target.closest(OPENER_OR_FIELD_SELECTOR)) return null;
    if (target.closest(TOOL_SWITCH_SELECTOR)) return null;
    if (entry.passes?.(target)) return null;
    if (openPopovers.some((other) => other !== entry && safeContains(other, target))) return null;
    return { entry, field };
  }
  return null;
}

const onWindowPointerDown = (event) => {
  // A right-click (context menu) has no opener control: forget the last one,
  // so a menu it opens never treats an earlier button as its toggle.
  const primary = event.button === 0 || event.pointerType !== 'mouse';
  lastPress = {
    control: primary ? (elementOf(event.target)?.closest?.(OPENER_CONTROL_SELECTOR) || null) : null,
    at: Date.now(),
  };
  if (openPopovers.length === 0) return;
  if (event.isPrimary === false) return; // second finger of a pinch
  if (event.pointerType === 'mouse' && event.button !== 0) return; // right-click menus keep working
  const target = elementOf(event.target);
  const typing = typingPressToEnd(target);
  if (typing) {
    // R3: this press only ends the typing (commits). Nothing else happens.
    consumeEvent(event);
    swallowRestOfPress(event);
    if (typing.entry.endTyping) typing.entry.endTyping(event);
    else typing.field.blur?.();
    // The consumed press never reaches the popovers' own outside handlers
    // (no mousedown follows a cancelled pointerdown), so close any light
    // popover left open beside the text — the typing it served is over.
    for (const entry of openPopovers.filter((other) => other !== typing.entry && other.kind !== 'typing').reverse()) {
      entry.close(event, 'typing-ended');
    }
    return;
  }
  const popovers = openPopovers.filter((entry) => entry.kind !== 'typing');
  if (popovers.length === 0 || !isBarePagePress(event)) return;
  // R2: the press only closes. It never reaches the canvas.
  consumeEvent(event);
  swallowRestOfPress(event);
  for (const entry of popovers.reverse()) entry.close(event, 'bare-page');
};

const onWindowKeyDown = (event) => {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  // R5: only the topmost surface — the popover opened last. A surface that
  // owns its own Escape (escape: false) keeps it; nothing under it closes.
  const entry = openPopovers[openPopovers.length - 1];
  if (!entry || !entry.escape) return;
  consumeEvent(event);
  const field = entry.typingField?.();
  if (field) {
    if (entry.endTyping) entry.endTyping(event);
    else field.blur?.();
    return;
  }
  entry.close(event, 'escape');
};

/**
 * Install the two window/capture guards (R2/R3 on pointerdown, R5 on Escape).
 * Runs once at module load, before any component effect registers its own
 * window/capture listener, so these always get the first look. The listeners
 * are thin forwarders to the latest module instance, so a dev hot-reload swaps
 * the logic without stacking a second pair. Exported for tests that build
 * their own window.
 */
export function installDismissRules(win) {
  if (!win) return;
  win.__surveyDismissRules = { onWindowPointerDown, onWindowKeyDown };
  if (win.__surveyDismissRulesInstalled) return;
  win.__surveyDismissRulesInstalled = true;
  win.addEventListener('pointerdown', (event) => win.__surveyDismissRules?.onWindowPointerDown(event), true);
  win.addEventListener('keydown', (event) => win.__surveyDismissRules?.onWindowKeyDown(event), true);
}

if (typeof window !== 'undefined') installDismissRules(window);

/** Test seam: run the guards against a hand-made event. */
export const __dismissRulesForTests = { onWindowPointerDown, onWindowKeyDown, openPopovers, typingPressToEnd };
