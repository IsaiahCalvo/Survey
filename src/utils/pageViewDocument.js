// pageViewDocument — an instant, in-memory "page view" over a loaded pdf.js
// document, so the Pages panel's page operations (move, delete, insert blank,
// duplicate/copy, rotate) show in the viewer and the thumbnails in the same
// frame as the tap, while the real PDF rewrite (pdf-lib) and upload run in the
// background (usePageOperations).
//
// The view looks like a PDFDocumentProxy to every consumer (viewer canvases,
// text/link/form layers, thumbnails, print, search): `numPages` and
// `getPage(n)` follow the view's page order, and a page's `rotate` /
// `getViewport()` include the view's extra rotation. Every other property and
// method is the base document's own. Pages that only moved are the SAME
// PDFPageProxy objects, so nothing is parsed again, and `pageViewKey()` lets
// raster/thumbnail caches reuse what is already drawn.
//
// The operations mirror utils/pdfPageMutation.js exactly, so the view always
// shows what the rewritten bytes will contain.

import { blankPageReferencePage, blankPageSize } from './blankPageSize.js';

const VIEW = Symbol('surveyPageView');
let viewSeq = 0;

const normRotation = (value) => ((Number(value) % 360) + 360) % 360;

export function isPageViewDocument(doc) {
  return Boolean(doc && doc[VIEW]);
}

export function getPageViewBase(doc) {
  return doc?.[VIEW]?.base || doc || null;
}

// Stable identity of what a view page shows (source page + extra rotation).
// The base document's own page n has key `${n - 1}`, matching the old
// per-index cache keys, so the first operation still hits warm caches.
export function pageViewKey(doc, pageIndex) {
  const entry = doc?.[VIEW]?.entries?.[pageIndex];
  if (!entry) return String(pageIndex);
  if (entry.blank) return `blank:${Math.round(entry.blank.width)}x${Math.round(entry.blank.height)}`;
  return entry.rot ? `${entry.src - 1}r${entry.rot}` : String(entry.src - 1);
}

// The same source page at no extra rotation, plus how far the view turns it.
// Lets a cache paint a just-rotated page from its upright bitmap at once.
export function pageViewUprightKey(doc, pageIndex) {
  const entry = doc?.[VIEW]?.entries?.[pageIndex];
  if (!entry || entry.blank || !entry.rot) return null;
  return { key: String(entry.src - 1), rotation: entry.rot };
}

// { [pageNumber]: { width, height } } at scale 1, rotation applied; pages
// whose size is not known yet are left out.
export function getPageViewSizes(doc) {
  const entries = doc?.[VIEW]?.entries;
  if (!entries) return null;
  const sizes = {};
  entries.forEach((entry, index) => {
    if (entry.size) sizes[index + 1] = { ...entry.size };
  });
  return sizes;
}

const swapSize = (size) => (size ? { width: size.height, height: size.width } : null);

function makeBlankPage(entry, pageNumber, getViewportImpl) {
  const { width, height } = entry.blank;
  const page = {
    pageNumber,
    rotate: entry.rot || 0,
    view: [0, 0, width, height],
    userUnit: 1,
    ref: null,
    isPureXfa: false,
    getViewport(opts = {}) {
      const viewport = getViewportImpl
        ? getViewportImpl.call(
          { view: page.view, userUnit: 1, rotate: page.rotate },
          { ...opts, rotation: opts.rotation ?? page.rotate },
        )
        : null;
      if (viewport) return viewport;
      const scale = Number(opts.scale) || 1;
      const turned = normRotation(opts.rotation ?? page.rotate) % 180 !== 0;
      return {
        width: (turned ? height : width) * scale,
        height: (turned ? width : height) * scale,
        scale,
        rotation: normRotation(opts.rotation ?? page.rotate),
        viewBox: page.view,
        transform: [scale, 0, 0, -scale, 0, height * scale],
        clone(next = {}) { return page.getViewport({ ...opts, ...next }); },
        convertToViewportPoint: (x, y) => [x * scale, (height - y) * scale],
        convertToViewportRectangle: (r) => [r[0] * scale, (height - r[1]) * scale, r[2] * scale, (height - r[3]) * scale],
        convertToPdfPoint: (x, y) => [x / scale, height - y / scale],
      };
    },
    render({ canvasContext, viewport } = {}) {
      try {
        if (canvasContext && viewport) {
          canvasContext.save();
          canvasContext.setTransform(1, 0, 0, 1, 0, 0);
          canvasContext.fillStyle = '#ffffff';
          canvasContext.fillRect(0, 0, canvasContext.canvas.width, canvasContext.canvas.height);
          canvasContext.restore();
        }
      } catch { /* a blank page never fails to render */ }
      return { promise: Promise.resolve(), cancel() {}, onContinue: null };
    },
    getTextContent: async () => ({ items: [], styles: {}, lang: null }),
    streamTextContent() {
      return new ReadableStream({ start(controller) { controller.close(); } });
    },
    getAnnotations: async () => [],
    getStructTree: async () => null,
    getJSActions: async () => ({}),
    getOperatorList: async () => ({ fnArray: [], argsArray: [], lastChunk: true }),
    cleanup: () => true,
  };
  return page;
}

function wrapPage(page, entry, pageNumber) {
  const rotate = normRotation((page.rotate || 0) + (entry.rot || 0));
  if (!entry.rot && page.pageNumber === pageNumber) return page;
  return new Proxy(page, {
    get(target, prop) {
      if (prop === 'rotate') return rotate;
      if (prop === 'pageNumber') return pageNumber;
      if (prop === 'getViewport') {
        return (opts = {}) => target.getViewport({ ...opts, rotation: opts.rotation ?? rotate });
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function buildView(base, entries) {
  const state = {
    base,
    entries,
    version: ++viewSeq,
    pages: new Map(),
    getViewportImpl: null,
  };
  const baseFingerprint = (base.fingerprints && base.fingerprints[0]) || base.fingerprint || 'doc';
  const fingerprints = [`${baseFingerprint}~pv${state.version}`, null];

  const getPage = (pageNumber) => {
    const n = Number(pageNumber);
    const entry = entries[n - 1];
    if (!Number.isInteger(n) || !entry) {
      return Promise.reject(new Error(`Invalid page request: ${pageNumber}`));
    }
    if (state.pages.has(n)) return state.pages.get(n);
    let promise;
    if (entry.blank) {
      promise = (state.getViewportImpl
        ? Promise.resolve(state.getViewportImpl)
        : base.getPage(1).then((first) => {
          state.getViewportImpl = Object.getPrototypeOf(first)?.getViewport || null;
          return state.getViewportImpl;
        }).catch(() => null)
      ).then((impl) => makeBlankPage(entry, n, impl));
    } else {
      promise = base.getPage(entry.src).then((page) => wrapPage(page, entry, n));
    }
    promise.catch(() => state.pages.delete(n));
    state.pages.set(n, promise);
    return promise;
  };

  const getPageIndex = async (ref) => {
    const baseIndex = await base.getPageIndex(ref);
    const viewIndex = entries.findIndex((entry) => !entry.blank && entry.src === baseIndex + 1);
    if (viewIndex < 0) throw new Error('The linked page was removed.');
    return viewIndex;
  };

  return new Proxy(base, {
    get(target, prop) {
      if (prop === VIEW) return state;
      if (prop === 'numPages') return entries.length;
      if (prop === 'getPage') return getPage;
      if (prop === 'getPageIndex') return getPageIndex;
      if (prop === 'fingerprints') return fingerprints;
      if (prop === 'fingerprint') return fingerprints[0];
      if (prop === '__pageViewVersion') return state.version;
      // The view never owns the worker document: PDFViewer destroys the base
      // when a different document loads.
      if (prop === 'destroy' || prop === 'cleanup') return async () => {};
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// Identity view over a freshly loaded document. `sizesByPage` is the viewer's
// { [page]: { width, height } } (scale 1, rotation applied); `pagesByNumber`
// the loaded PDFPageProxy objects when known (for blank-page sizing).
export function createPageView(baseDoc, { sizesByPage = {}, pagesByNumber = {} } = {}) {
  const base = getPageViewBase(baseDoc);
  const entries = Array.from({ length: base.numPages }, (_, index) => {
    const n = index + 1;
    const size = sizesByPage?.[n];
    const page = pagesByNumber?.[n];
    return {
      src: n,
      rot: 0,
      size: size && Number.isFinite(size.width) && Number.isFinite(size.height)
        ? { width: size.width, height: size.height }
        : null,
      // Unrotated media size of the source page (pdf-lib's getSize() for an
      // inserted blank page uses exactly this).
      media: page?.view ? { width: page.view[2] - page.view[0], height: page.view[3] - page.view[1] } : null,
      baseRotate: Number.isFinite(page?.rotate) ? normRotation(page.rotate) : null,
    };
  });
  return buildView(base, entries);
}

const pageIndexOf = (value, count, label) => {
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1 || page > count) {
    throw new RangeError(`${label} must be between 1 and ${count}`);
  }
  return page - 1;
};

// An insertion slot as an index: -1 = before the first page.
const slotIndexOf = (value, count, label) => {
  const slot = Number(value);
  if (!Number.isInteger(slot) || slot < 0 || slot > count) {
    throw new RangeError(`${label} must be between 0 and ${count}`);
  }
  return slot - 1;
};

// Returns a NEW view with `operation` applied (same op shapes as
// mutatePdfPages). `doc` may be the base document or a previous view.
export function applyPageViewOperation(doc, operation, options = {}) {
  const view = isPageViewDocument(doc) ? doc : createPageView(doc, options);
  const { base, entries: current } = view[VIEW];
  const entries = current.map((entry) => ({ ...entry }));
  const count = entries.length;
  const type = operation?.type;

  if (type === 'delete') {
    if (count <= 1) throw new Error('A PDF must keep at least one page.');
    entries.splice(pageIndexOf(operation.page, count, 'page'), 1);
  } else if (type === 'insert') {
    // Sized like the page above it as shown, stored unturned
    // (utils/blankPageSize.js, the same rule as the pdf-lib rewrite).
    const after = slotIndexOf(operation.afterPage, count, 'afterPage');
    const reference = entries[blankPageReferencePage(after + 1, count) - 1];
    const media = reference.blank || reference.media;
    // How far the reference is turned on screen (null when its own
    // rotation is not known yet; then its displayed size is used).
    let turn = null;
    if (reference.blank) turn = reference.rot || 0;
    else if (reference.baseRotate != null) turn = reference.baseRotate + (reference.rot || 0);
    let blank;
    if (media && turn != null) blank = blankPageSize({ ...media, rotation: turn });
    else if (reference.size) blank = { width: reference.size.width, height: reference.size.height };
    else blank = blankPageSize({ ...(media || {}), rotation: reference.rot || 0 });
    entries.splice(after + 1, 0, { src: null, rot: 0, blank, size: { ...blank }, media: { ...blank }, baseRotate: 0 });
  } else if (type === 'duplicate' || type === 'copy') {
    const source = pageIndexOf(operation.page ?? operation.source, count, 'source');
    const after = slotIndexOf(operation.afterPage ?? operation.page ?? operation.target, count, 'afterPage');
    entries.splice(after + 1, 0, { ...entries[source] });
  } else if (type === 'move' || type === 'reorder') {
    const from = pageIndexOf(operation.from, count, 'from');
    const to = pageIndexOf(operation.to, count, 'to');
    if (from !== to) {
      const [moved] = entries.splice(from, 1);
      entries.splice(to, 0, moved);
    }
  } else if (type === 'rotate') {
    const index = pageIndexOf(operation.page, count, 'page');
    const delta = Number(operation.delta ?? 90);
    if (!Number.isFinite(delta) || delta % 90 !== 0) throw new Error('rotation delta must be a multiple of 90');
    const entry = entries[index];
    entry.rot = normRotation((entry.rot || 0) + delta);
    if (entry.blank) {
      // A blank page has no source to turn; the view rotates the stub itself.
      entry.blank = { ...entry.blank };
    }
    if (normRotation(delta) % 180 !== 0) entry.size = swapSize(entry.size);
  } else {
    throw new Error(`Unsupported PDF page mutation: ${type}`);
  }

  return buildView(base, entries);
}
