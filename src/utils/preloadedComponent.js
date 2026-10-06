import { createElement, forwardRef, lazy, useEffect, useState } from 'react';

/**
 * A component whose code sits in its own chunk, so the first screen does not
 * have to download it, but which renders straight away once that chunk is in
 * memory. React.lazy always suspends for one render even when the chunk has
 * already arrived; this does not, so a screen that preloads the chunk (see
 * `load`) never shows an empty frame where the component belongs.
 *
 * If the component is asked to render before its chunk has arrived it renders
 * nothing and fills in as soon as the chunk is ready.
 *
 * @param {() => Promise<object>} importer  e.g. () => import('./PDFSidebar')
 * @param {(module: object) => Function} [pick]  which export is the component
 * @returns {{ load: () => Promise<Function>, Component: Function }}
 */
export function preloadedComponent(importer, pick = (module) => module.default) {
  let Loaded = null;
  let pending = null;

  const load = () => {
    if (Loaded) return Promise.resolve(Loaded);
    if (!pending) {
      pending = Promise.resolve()
        .then(importer)
        .then((module) => {
          Loaded = pick(module);
          return Loaded;
        });
      // A failed fetch (offline, stale deploy) may be retried by the next call.
      pending.catch(() => { pending = null; });
    }
    return pending;
  };

  // The ref is passed through: the rails are forwardRef components and the
  // app drives them through it (Pages / Search / Spaces on the phone dock,
  // Ctrl+F, the Spaces chip). React 18 does not hand `ref` to a plain function
  // component, so without forwardRef those calls found no panel API.
  const Preloaded = forwardRef(function Preloaded(props, ref) {
    const [, setReady] = useState(Boolean(Loaded));
    useEffect(() => {
      if (Loaded) return undefined;
      let live = true;
      load().then(() => { if (live) setReady(true); }, () => {});
      return () => { live = false; };
    }, []);
    return Loaded ? createElement(Loaded, ref ? { ...props, ref } : props) : null;
  });

  return { load, Component: Preloaded };
}

/**
 * React.lazy, except a failed download does not stick.
 *
 * React.lazy keeps a rejected import forever: one failed fetch of the chunk
 * (offline, or a stale deploy whose old chunk file is gone) and every later
 * render throws that error to the app's error boundary, so the screen cannot
 * open again until the page is reloaded ("Try again" on the crash screen just
 * crashes again). Here a failed load renders `Failed` in its place, given
 * `{ error, retry }`, and the next mount (or `retry()`) fetches afresh.
 *
 * A failed load is not refetched by itself: React mounts the child again once
 * the load settles, and refetching there would loop for as long as the device
 * is offline. Only a real unmount (closing the file) or `retry` tries again.
 * Note Chromium and WebKit remember a failed module download for the life of
 * the page, so in those a retry fails again at once without touching the
 * network; the gain there is no crash, and the caller can offer a reload.
 *
 * @param {() => Promise<{ default: Function }>} factory  as for React.lazy
 * @param {Function} Failed  rendered with `{ error, retry }` when the load failed
 */
export function retryingLazy(factory, Failed) {
  const attempt = () => {
    const entry = { failed: false, retry: null };
    entry.Lazy = lazy(() => Promise.resolve().then(factory).catch((error) => {
      entry.failed = true;
      return {
        default: function LoadFailed() {
          return createElement(Failed, { error, retry: () => entry.retry?.() });
        },
      };
    }));
    return entry;
  };
  let current = attempt();

  return function RetryingLazy(props) {
    const [entry, setEntry] = useState(() => current);
    useEffect(() => {
      entry.retry = () => {
        if (current === entry) current = attempt();
        setEntry(current);
      };
      return () => {
        entry.retry = null;
        if (entry.failed && current === entry) current = attempt();
      };
    }, [entry]);
    return createElement(entry.Lazy, props);
  };
}
