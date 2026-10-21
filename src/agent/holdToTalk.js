// The chat mic button: hold to talk, let go to send, slide off to cancel.
// A quick tap still works as before: tap to start, tap again to send. Kept
// free of the browser so node tests can drive it with plain numbers.

export const HOLD_TAP_MS = 350;
export const HOLD_CANCEL_PX = 60;

/**
 * start()/stop()/cancel() drive the recorder; recording() says whether it is
 * on (or starting). onChange({ holding, cancelling }) updates the button.
 * down/move/up take the pointer's x, y and the time in ms.
 */
export function createHoldToTalk({ start, stop, cancel, recording, onChange, tapMs = HOLD_TAP_MS, cancelPx = HOLD_CANCEL_PX }) {
  let press = null;
  // holding: pressed to talk (not the press that ends a tapped recording).
  const show = () => onChange?.({ holding: Boolean(press && !press.stops), cancelling: Boolean(press?.cancelling) });
  return {
    down(x, y, t) {
      // Already on from a tap: this press ends it (sends on release).
      press = { x, y, t, held: false, cancelling: false, stops: recording() };
      if (!press.stops) start();
      show();
    },
    move(x, y, t) {
      if (!press || press.stops) return;
      if (!press.held && t - press.t >= tapMs) press.held = true;
      const far = Math.hypot(x - press.x, y - press.y) > cancelPx;
      if (far !== press.cancelling) { press.cancelling = far; press.held = true; show(); }
    },
    up(t) {
      if (!press) return;
      const p = press;
      press = null;
      if (p.stops) stop();
      else if (p.cancelling) cancel();
      // Held: let go sends. A quick tap leaves it on until the next tap.
      else if (p.held || t - p.t >= tapMs) stop();
      show();
    },
    /** The press was taken away (a scroll, a call): drop what was said. */
    abort() {
      if (!press) return;
      const p = press;
      press = null;
      if (!p.stops) cancel();
      show();
    },
    get pressing() { return Boolean(press); },
  };
}
