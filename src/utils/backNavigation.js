/**
 * backNavigation.js — the browser back gesture and the Android back button
 * close what is open before they leave a document (Nightly, flag
 * 'back-button'; Drawboard PDF Pro trial audit 2026-11-09).
 *
 * Before, opening a document added no history entry, so back from inside a
 * document left Survey (the web) or quit the app (Android). Now, while a
 * document is on screen it owns one history entry. Back pops it, and then:
 *
 *   1. a phone flyout registered with useBackLayer closes, else
 *   2. the topmost dialog or sheet closes (the shared trap list in
 *      src/hooks/modalStack.js, through its own Escape path), else
 *   3. the document closes and the home screen shows.
 *
 * After 1 or 2 the entry is put back, so the next back goes on down the list.
 * When the document closes some other way (its back arrow, the home tab), the
 * entry is taken off again quietly, so back from home does not land on it.
 */
import { useEffect, useRef } from 'react';
import { openModalStack } from '../hooks/modalStack.js';

const MARK = 'surveyViewerBack';
const HOME_MARK = 'surveyHomeBack';
const layers = [];

// Told whenever a layer or a dialog opens or closes (pushBackLayer here, and
// the two focus-trap hooks for the shared dialog list).
const layerListeners = new Set();
export function notifyBackLayersChanged() {
  layerListeners.forEach((listener) => { try { listener(); } catch { /* one bad listener */ } });
}

/** Register an open layer (a flyout with no Escape path); returns its removal. */
export function pushBackLayer(close) {
  const entry = { close };
  layers.push(entry);
  notifyBackLayersChanged();
  return () => {
    const index = layers.indexOf(entry);
    if (index !== -1) layers.splice(index, 1);
    notifyBackLayersChanged();
  };
}

/** While `open`, back closes this layer by calling `close`. */
export function useBackLayer(open, close) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return undefined;
    return pushBackLayer(() => closeRef.current?.());
  }, [open]);
}

/** Close the topmost open layer. True when something was open. */
export function closeTopBackLayer(doc = typeof document !== 'undefined' ? document : null) {
  if (layers.length) {
    layers[layers.length - 1].close();
    return true;
  }
  if (openModalStack.length && doc) {
    const target = doc.activeElement && doc.activeElement !== doc.documentElement ? doc.activeElement : doc.body;
    target?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return true;
  }
  return false;
}

export function backLayerCount() {
  return layers.length + openModalStack.length;
}

const hasMark = (win) => Boolean(win.history.state && win.history.state[MARK]);
const pushMark = (win) => win.history.pushState({ ...(win.history.state || {}), [MARK]: true }, '');

// Backs this module started itself (taking a closed document's entry off).
// Their popstate is swallowed before any other listener sees it.
let quietBacks = 0;
let active = null;
const swallowing = new WeakSet();
// Told after a quiet back has landed (history.state is the entry below now).
const quietListeners = new Set();

function installSwallow(win) {
  if (swallowing.has(win)) return;
  swallowing.add(win);
  win.addEventListener('popstate', (event) => {
    if (quietBacks <= 0) return;
    quietBacks -= 1;
    event.stopImmediatePropagation();
    // A document opened again before the quiet back finished: give it its
    // entry back.
    if (active && active.win === win && !hasMark(win)) pushMark(win);
    quietListeners.forEach((listener) => { try { listener(); } catch { /* one bad listener */ } });
  }, true);
}

/**
 * While a document is on screen: own one history entry, and on back close the
 * top layer or call `onLeave`. Returns the cleanup for when it leaves.
 */
export function installViewerBack(win, onLeave) {
  if (!win?.history?.pushState) return () => {};
  installSwallow(win);
  const session = { win };
  active = session;
  if (!hasMark(win) && quietBacks === 0) pushMark(win);
  const onPop = () => {
    if (active !== session) return;
    if (closeTopBackLayer(win.document)) {
      pushMark(win);
      return;
    }
    onLeave?.();
  };
  win.addEventListener('popstate', onPop);
  return () => {
    win.removeEventListener('popstate', onPop);
    if (active === session) active = null;
    if (hasMark(win)) {
      quietBacks += 1;
      win.history.back();
    }
  };
}

/**
 * On the home screen (no document open): while a sheet or dialog is open
 * (Settings, Share, a details sheet...), own one history entry, so back
 * closes the top one instead of leaving Survey or minimising the app with it
 * still open (Drawboard PDF Pro trial audit 2026-11-09, round 2). With
 * nothing open there is no entry, and back does what it always did.
 */
export function installHomeBack(win) {
  if (!win?.history?.pushState) return () => {};
  installSwallow(win);
  // history.back() lands later (popstate), so until it does the entry still
  // reads as ours: `leaving` says it is already on its way out, so nothing
  // backs twice (two backs stepped past Survey's own first entry, R3-X).
  let leaving = false;
  const hasHome = () => Boolean(win.history.state && win.history.state[HOME_MARK]);
  const owns = () => hasHome() && !leaving;
  let alive = true;
  const takeOff = () => {
    leaving = true;
    quietBacks += 1;
    win.history.back();
  };
  const sync = () => {
    if (!alive) return;
    const open = backLayerCount() > 0;
    if (open && !hasHome() && quietBacks === 0) {
      win.history.pushState({ ...(win.history.state || {}), [HOME_MARK]: true }, '');
    } else if (!open && owns()) {
      takeOff();
    }
  };
  // A sheet that hands over to a dialog (New, then Blank document) took the
  // entry off as it closed; once that back lands, the dialog gets its own.
  const afterQuiet = () => {
    leaving = false;
    sync();
  };
  quietListeners.add(afterQuiet);
  const onPop = () => {
    // Our entry was just taken off by back: close the top sheet. If more stay
    // open, the change it makes puts the entry back (sync).
    if (hasHome() || backLayerCount() === 0) return;
    closeTopBackLayer(win.document);
    // A dialog that is busy (New document while it creates) ignores the
    // Escape: it stays open with no entry under it, and a later back left
    // Survey (R3-Z). Look again once it has had time to close.
    win.setTimeout?.(sync, 250);
  };
  layerListeners.add(sync);
  win.addEventListener('popstate', onPop);
  sync();
  return () => {
    alive = false;
    layerListeners.delete(sync);
    quietListeners.delete(afterQuiet);
    win.removeEventListener('popstate', onPop);
    if (owns()) takeOff();
  };
}

/**
 * Android back button in the app. Registering any listener turns off
 * Capacitor's own (go back, else quit), so it is repeated here; with the flag
 * on, back at the bottom of the history minimises instead of quitting, as
 * Android apps do.
 */
export function nativeBackAction({ canGoBack, enabled }) {
  if (canGoBack) return 'back';
  return enabled ? 'minimize' : 'exit';
}

/** For tests. */
export function resetBackNavigationForTests() {
  layers.length = 0;
  quietBacks = 0;
  active = null;
  quietListeners.clear();
}
