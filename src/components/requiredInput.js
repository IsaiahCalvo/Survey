/**
 * requiredInput.js — the app's ONE "this field can't be empty" treatment.
 *
 * `flagRequiredInput(inputEl, message)` — call it when the user tries to commit
 * a required text input that is empty (or whitespace-only). The field flashes a
 * red bottom edge and shakes once over ~320ms, and a small hint slides in
 * beneath it and auto-dismisses after ~2s.
 *
 * UX intent (KAL-69): a blank commit must be *refused visibly*. Silently
 * dropping the edit leaves the user staring at an empty field, unsure whether it
 * saved; a persistent red error is too heavy for something they fix in the next
 * keystroke. A one-shot shake plus a self-clearing hint says "not that, try
 * again" and then gets out of the way.
 *
 * The red here is the WARMER validation red (#d97766), deliberately not the
 * cooler destructive red used for irreversible actions — see docs/ui/colors.md.
 * Do not collapse the two.
 *
 * Deliberately DOM-level rather than React state: the inputs that need this are
 * uncontrolled (`defaultValue`) precisely so typing doesn't re-render a large
 * editor, and the surrounding code already writes `el.value` directly to revert.
 * A hook would force those inputs to become controlled.
 *
 * Companion rule the CALLER owns (this helper can't know which case it is):
 *   - existing row blanked then blurred -> quietly restore the previous value,
 *     no shake. Blanking a row must never be a way to delete it.
 *   - fresh blank row -> flagRequiredInput(), row stays open for input.
 *   - Escape on a fresh blank row -> remove the row outright.
 */

const HINT_CLASS = 'required-input-hint';
const INVALID_CLASS = 'required-input--invalid';
const SHAKE_MS = 320;
const HINT_MS = 2000;

// One timer set per element, so rapid re-triggers restart cleanly instead of
// stacking and leaving an orphaned hint behind.
const timers = new WeakMap();

const clearTimers = (el) => {
  const t = timers.get(el);
  if (!t) return;
  clearTimeout(t.shake);
  clearTimeout(t.hint);
  t.hintEl?.remove();
  timers.delete(el);
};

// The hint is body-mounted and positioned from the input's rect rather than
// inserted next to it. These inputs sit inside tight flex rows and scrollable
// panels, so an in-flow hint would either shove the row's other controls
// sideways for two seconds or get clipped by the panel's overflow.
const mountHint = (inputEl, message) => {
  const rect = inputEl.getBoundingClientRect();
  const hintEl = document.createElement('div');
  hintEl.className = HINT_CLASS;
  hintEl.textContent = message;
  // aria-live so a screen-reader user hears the refusal — they get no shake.
  hintEl.setAttribute('role', 'status');
  hintEl.setAttribute('aria-live', 'polite');
  hintEl.style.position = 'fixed';
  hintEl.style.left = `${Math.round(rect.left)}px`;
  hintEl.style.top = `${Math.round(rect.bottom + 4)}px`;
  hintEl.style.maxWidth = `${Math.max(180, Math.round(rect.width))}px`;
  hintEl.style.zIndex = '10050';
  document.body.appendChild(hintEl);
  return hintEl;
};

export function flagRequiredInput(inputEl, message) {
  if (!inputEl || typeof inputEl.getBoundingClientRect !== 'function') return;

  clearTimers(inputEl);

  // Restart the animation even if the class is already applied — without the
  // reflow the browser coalesces remove+add into no change at all.
  inputEl.classList.remove(INVALID_CLASS);
  void inputEl.offsetWidth;
  inputEl.classList.add(INVALID_CLASS);

  const hintEl = message ? mountHint(inputEl, message) : null;

  timers.set(inputEl, {
    hintEl,
    shake: setTimeout(() => inputEl.classList.remove(INVALID_CLASS), SHAKE_MS),
    hint: setTimeout(() => { hintEl?.remove(); timers.delete(inputEl); }, HINT_MS),
  });
}

/** Whitespace-only counts as empty. */
export const isBlank = (value) => !String(value ?? '').trim();

