import { createElement, forwardRef, useEffect, useState } from 'react';

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
