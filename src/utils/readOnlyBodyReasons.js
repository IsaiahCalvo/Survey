const claimsByDocument = new WeakMap();

function getState(doc) {
  let state = claimsByDocument.get(doc);
  if (!state) {
    state = {
      claims: new Set(),
      inherited: doc.body?.getAttribute('data-readonly') === 'true',
    };
    claimsByDocument.set(doc, state);
  }
  return state;
}

export function claimBodyReadOnly(token, doc = globalThis.document) {
  if (!doc?.body || token == null) return () => {};
  const state = getState(doc);
  state.claims.add(token);
  doc.body.setAttribute('data-readonly', 'true');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.claims.delete(token);
    if (state.claims.size > 0 || state.inherited) {
      doc.body.setAttribute('data-readonly', 'true');
    } else {
      doc.body.removeAttribute('data-readonly');
      claimsByDocument.delete(doc);
    }
  };
}
