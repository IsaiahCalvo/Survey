/**
 * backdropBlur.js — keep the frosted dialog backdrop on capable devices, drop
 * it on weak ones.
 *
 * Launch polish (2026-11-02, open item "dialog backdrop blur slows slow PCs"):
 * every dialog, sheet and modal scrim pairs --overlay-scrim with
 * `backdrop-filter: blur(8px)`. On a weak GPU the browser re-blurs the whole
 * page under the scrim on every frame the dialog animates or the page behind
 * it repaints, which is what made dialogs feel slow there. The owner wants the
 * look kept, so the blur stays wherever the device can afford it.
 *
 * Published as `<html data-backdrop-blur="off">` on a weak device; no
 * attribute otherwise. styles.css turns every backdrop-filter off under that
 * attribute (and under prefers-reduced-transparency) and deepens the scrim a
 * little so a dialog still stands clear of the page.
 *
 * Override for testing on any device: localStorage
 * `survey.backdropBlur` = 'off' | 'on'.
 */

const ROOT_ATTRIBUTE = 'data-backdrop-blur';
const OVERRIDE_KEY = 'survey.backdropBlur';

// Chrome / Edge report deviceMemory in GB, rounded down and capped at 8; most
// browsers report logical cores. 4 GB / 4 threads or fewer is a budget laptop,
// an older tablet, or a low-end phone.
const WEAK_MEMORY_GB = 4;
const WEAK_CORES = 4;

/**
 * Whether a device should skip the backdrop blur. Pure; exported for tests.
 * @param {{ deviceMemory?: number, hardwareConcurrency?: number }} nav
 * @param {string|null} [override] 'off' forces the blur off, 'on' keeps it.
 */
export function shouldDropBackdropBlur(nav, override = null) {
  if (override === 'off') return true;
  if (override === 'on') return false;
  const memory = Number(nav?.deviceMemory);
  if (Number.isFinite(memory) && memory > 0 && memory <= WEAK_MEMORY_GB) return true;
  const cores = Number(nav?.hardwareConcurrency);
  if (Number.isFinite(cores) && cores > 0 && cores <= WEAK_CORES) return true;
  return false;
}

function readOverride(win) {
  try {
    const value = win?.localStorage?.getItem(OVERRIDE_KEY);
    return value === 'off' || value === 'on' ? value : null;
  } catch {
    return null;
  }
}

export function installBackdropBlurTier(win = typeof window !== 'undefined' ? window : undefined) {
  const root = win?.document?.documentElement;
  if (!root) return false;
  const drop = shouldDropBackdropBlur(win.navigator, readOverride(win));
  if (drop) root.setAttribute(ROOT_ATTRIBUTE, 'off');
  else root.removeAttribute(ROOT_ATTRIBUTE);
  return drop;
}
