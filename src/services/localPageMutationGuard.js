// Page bytes and page-addressed marks must describe one revision. Stop local
// input only for the bounded rewrite/commit; cloud collaboration is unchanged.
export async function guardLocalPageMutation({ document, pendingRef, flush, run }) {
  if (pendingRef.current || document.documentElement.inert) throw new Error('A save or page action is already running. Try again when it finishes.');
  if (document.querySelector('[data-text-edit-overlay]')) throw new Error('Finish editing text before changing pages.');
  flush(() => document.activeElement?.blur?.());
  const root = document.documentElement;
  const wasBusy = root.getAttribute('aria-busy');
  pendingRef.current = true;
  root.inert = true;
  root.setAttribute('aria-busy', 'true');
  const stop = event => { event.preventDefault(); event.stopImmediatePropagation(); };
  const target = document.defaultView || document;
  const events = ['pointerdown', 'keydown', 'beforeinput', 'paste', 'drop'];
  events.forEach(name => target.addEventListener(name, stop, true));
  try { return await run(); }
  finally {
    events.forEach(name => target.removeEventListener(name, stop, true));
    root.inert = false;
    if (wasBusy === null) root.removeAttribute('aria-busy'); else root.setAttribute('aria-busy', wasBusy);
    pendingRef.current = false;
  }
}
