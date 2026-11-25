// pdf.js's guard against a text drag running to the end of the page
// (TextLayerBuilder's `.endOfContent`, pdfjs-dist web/pdf_viewer.mjs). When a
// drag leaves the words for blank paper, the browser finds no glyph under the
// pointer and stretches the selection to the layer's last text run: one short
// Squiggle marked every run on the sheet and Remove text marks took every
// mark off (#1668, #1669, #1650). A hidden block sits after the text and, while
// a drag is live, covers the whole layer, so blank paper ends the selection
// where the words stopped. Older Chromium also needs the block moved next to
// the selection's moving end on each change; Firefox and Chromium 148+ don't.
// Keep in step with pdf.js when it is upgraded.

export const END_OF_CONTENT_CLASS = 'endOfContent';

export const END_OF_CONTENT_CSS = `
    .pdfjsTextLayer .${END_OF_CONTENT_CLASS} { display: block; position: absolute; inset: 100% 0 0; z-index: 0; cursor: default; -webkit-user-select: none; user-select: none; }
    .pdfjsTextLayer.selecting .${END_OF_CONTENT_CLASS} { top: 0; }
`;

const layers = new Set();
let listenerAbort = null;
let movesEnd = null;
let prevRange = null;

export function endOfContentFor(layer) {
  const doc = layer?.ownerDocument;
  if (!doc) return null;
  let end = Array.from(layer.children || []).find((child) => child.classList?.contains(END_OF_CONTENT_CLASS));
  if (!end) {
    end = doc.createElement('div');
    end.className = END_OF_CONTENT_CLASS;
    layer.append(end);
  }
  return end;
}

export function isEndOfContentNode(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  return Boolean(element?.closest?.(`.${END_OF_CONTENT_CLASS}`));
}

function reset(layer) {
  const end = endOfContentFor(layer);
  if (end) {
    layer.append(end);
    end.style.width = '';
    end.style.height = '';
    end.style.userSelect = '';
  }
  layer.classList.remove('selecting');
}

// pdf.js: Firefox and Chromium 148+ stop the drag at the covering block on
// their own; older Chromium needs the block moved after each change.
function browserMovesEnd(win, layer) {
  try {
    if (win.getComputedStyle(layer).getPropertyValue('-moz-user-select') === 'none') return false;
  } catch { /* no styles: treat as Chromium */ }
  const nav = win.navigator || {};
  const version = nav.userAgentData?.brands?.find?.(({ brand }) => brand === 'Chromium')?.version
    || /\bChrome\/(\d+)\b/.exec(nav.userAgent || '')?.[1];
  return !(version && parseInt(version, 10) >= 148);
}

function onSelectionChange(doc, win) {
  const selection = doc.getSelection?.();
  if (!selection || selection.rangeCount === 0) {
    layers.forEach(reset);
    return;
  }
  const active = new Set();
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    for (const layer of layers) {
      if (!active.has(layer) && range.intersectsNode(layer)) active.add(layer);
    }
  }
  for (const layer of layers) {
    if (active.has(layer)) layer.classList.add('selecting');
    else reset(layer);
  }
  if (!active.size) return;
  if (movesEnd === null) movesEnd = browserMovesEnd(win, active.values().next().value);
  if (!movesEnd) return;

  const range = selection.getRangeAt(0);
  const RangeCtor = win.Range;
  const modifyStart = prevRange && (
    range.compareBoundaryPoints(RangeCtor.END_TO_END, prevRange) === 0
    || range.compareBoundaryPoints(RangeCtor.START_TO_END, prevRange) === 0
  );
  let anchor = modifyStart ? range.startContainer : range.endContainer;
  if (anchor?.nodeType === 3) anchor = anchor.parentNode;
  if (!modifyStart && range.endOffset === 0) {
    do {
      while (anchor && !anchor.previousSibling) anchor = anchor.parentNode;
      anchor = anchor?.previousSibling;
    } while (anchor && !anchor.childNodes.length);
  }
  const layer = anchor?.parentElement?.closest?.('.pdfjsTextLayer');
  if (layer && layers.has(layer)) {
    const end = endOfContentFor(layer);
    end.style.width = layer.style.width;
    end.style.height = layer.style.height;
    end.style.userSelect = 'text';
    anchor.parentElement.insertBefore(end, modifyStart ? anchor : anchor.nextSibling);
  }
  prevRange = range.cloneRange();
}

function startListening(doc, win) {
  if (listenerAbort) return;
  listenerAbort = new (win.AbortController || AbortController)();
  const { signal } = listenerAbort;
  let pointerDown = false;
  doc.addEventListener('pointerdown', () => { pointerDown = true; }, { signal });
  doc.addEventListener('pointerup', () => { pointerDown = false; layers.forEach(reset); }, { signal });
  win.addEventListener('blur', () => { pointerDown = false; layers.forEach(reset); }, { signal });
  doc.addEventListener('keyup', () => { if (!pointerDown) layers.forEach(reset); }, { signal });
  doc.addEventListener('selectionchange', () => onSelectionChange(doc, win), { signal });
}

/** Guards one interactive text layer; returns the undo. */
export function guardTextLayerDrag(layer) {
  const doc = layer?.ownerDocument;
  const win = doc?.defaultView;
  if (!doc || !win) return () => {};
  // The layer is rebuilt in place (innerHTML = '' then pdf.js render), so the
  // block is put back on each press rather than once.
  const onMouseDown = () => {
    endOfContentFor(layer);
    layer.classList.add('selecting');
  };
  layer.addEventListener('mousedown', onMouseDown);
  layers.add(layer);
  endOfContentFor(layer);
  startListening(doc, win);
  return () => {
    layer.removeEventListener('mousedown', onMouseDown);
    reset(layer);
    layers.delete(layer);
    if (layers.size === 0) {
      listenerAbort?.abort();
      listenerAbort = null;
      prevRange = null;
    }
  };
}
