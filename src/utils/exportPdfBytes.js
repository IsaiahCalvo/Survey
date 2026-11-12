// The byte work behind Export PDF choices (see exportPdfModes.js). Loaded on
// demand at export time, since pdf-lib is large.
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNull, PDFRef, PDFStream, PDFString, PDFHexString } from 'pdf-lib';
import { PDF_APP_LAYER_STATE_KEY } from './pdfAppAnnotationMetadata.js';
import { readPdfLibText } from './pdfLibValueReaders.js';
import { pdfTextString } from './pdfUnicodeText.js';
import { normalizePresentationPdf, reflectPdfPagePresentations } from './pdfPagePresentation.js';

const PRESENTATION_TAG = 'SurveyPagePresentation';

const toBytes = async (src) => {
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (typeof src?.arrayBuffer === 'function') return new Uint8Array(await src.arrayBuffer());
  throw new Error('Nothing to export.');
};

// Kept by Plain: links still jump, and form fields are part of the drawing.
const PLAIN_KEEPS = new Set(['/Link', '/Widget']);

/**
 * Plain: every markup the PDF carries (comments, ink, shapes, stamps...) is
 * taken off, and so is Survey's own hidden copy of its marks (the catalog's
 * SurveyAppLayerState), or reopening the file in Survey would bring them
 * back. Links and form fields stay. A mirrored page is exported mirrored,
 * like the other choices: a mirror Survey baked into the source is undone
 * first, then `pageTransformations` (or that baked mirror) is applied.
 */
export async function stripMarkupAnnotations(src, { pageTransformations = null } = {}) {
  const source = await normalizePresentationPdf(await toBytes(src));
  const doc = await PDFDocument.load(source.bytes, { ignoreEncryption: true, updateMetadata: false });
  const { context } = doc;
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    const keep = annots.asArray().filter((ref) => {
      const annot = context.lookup(ref);
      if (!(annot instanceof PDFDict)) return false;
      const subtype = annot.get(PDFName.of('Subtype'));
      return PLAIN_KEEPS.has(subtype?.toString());
    });
    if (keep.length) page.node.set(PDFName.of('Annots'), context.obj(keep));
    else page.node.delete(PDFName.of('Annots'));
  }
  doc.catalog.delete(PDFName.of(PDF_APP_LAYER_STATE_KEY));
  await reflectPdfPagePresentations(doc, pageTransformations || source.presentations || {});
  return doc.save();
}

/**
 * Survey's hidden layer state (SurveyAppLayerState) for a file cut down to
 * `pages` (1-based, any order): entries on other pages are dropped and page
 * numbers become the new ones (the 3rd kept page is page 3). Pure.
 */
export function remapLayerStateToPages(state, pages) {
  if (!state?.layers || typeof state.layers !== 'object') return state;
  const order = [...new Set(pages)].sort((a, b) => a - b);
  const to = new Map(order.map((page, index) => [page, index + 1]));
  const next = (value) => to.get(Number(value)) ?? null;
  const layers = { ...state.layers };
  if (layers.scopedAnnotationsByPage && typeof layers.scopedAnnotationsByPage === 'object') {
    layers.scopedAnnotationsByPage = Object.fromEntries(Object.entries(layers.scopedAnnotationsByPage)
      .filter(([page]) => next(page))
      .map(([page, data]) => [String(next(page)), data]));
  }
  if (Array.isArray(layers.callouts)) {
    layers.callouts = layers.callouts
      .filter((callout) => next(callout?.pageNumber || 1))
      .map((callout) => ({ ...callout, pageNumber: next(callout?.pageNumber || 1) }));
  }
  for (const key of ['surveyMarkers', 'highlightAnnotations']) {
    if (!layers[key] || typeof layers[key] !== 'object') continue;
    layers[key] = Object.fromEntries(Object.entries(layers[key])
      .filter(([, marker]) => next(marker?.pageNumber))
      .map(([id, marker]) => [id, { ...marker, pageNumber: next(marker.pageNumber) }]));
  }
  if (Array.isArray(layers.spaces)) {
    layers.spaces = layers.spaces.map((space) => ({
      ...space,
      assignedPages: Array.isArray(space?.assignedPages)
        ? space.assignedPages.filter((page) => next(page?.pageId)).map((page) => ({ ...page, pageId: next(page.pageId) }))
        : space?.assignedPages,
    }));
  }
  return { ...state, layers };
}

const renumberPageKeys = (byPage, pages) => {
  const order = [...new Set(pages)].sort((a, b) => a - b);
  return Object.fromEntries(order.flatMap((page, index) => (byPage?.[page] ? [[String(index + 1), byPage[page]]] : [])));
};

// ── Cutting pages out for real ──────────────────────────────────────────
// pdf-lib's removePage only unhooks a page from the page tree: the page, its
// drawing and its text stay in the saved file, and bookmarks, links, named
// destinations, form fields and the tag tree still point at it. A page pick
// must not carry the cut pages along (Linear KAL-537 study: a 2-of-4 export
// kept both cut pages' content, reachable from their bookmarks). So every
// pointer to a cut page is removed and then everything no longer reachable
// from the file's root is dropped before saving.

const nameKey = (value) => ((value instanceof PDFString || value instanceof PDFHexString) ? value.decodeText()
  : value instanceof PDFName ? value.decodeText() : null);

// The page a destination points at: a PDFRef, or null when it names no page
// or names a destination we cannot find.
function destinationPage(context, value, namedDests, depth = 0) {
  if (depth > 8 || value == null) return null;
  const v = value instanceof PDFRef ? context.lookup(value) : value;
  if (v instanceof PDFArray) {
    const first = v.get(0);
    return first instanceof PDFRef ? first : null;
  }
  if (v instanceof PDFDict) {
    if (v.has(PDFName.of('D'))) return destinationPage(context, v.get(PDFName.of('D')), namedDests, depth + 1);
    return null;
  }
  const key = nameKey(v);
  if (key != null && namedDests.has(key)) return destinationPage(context, namedDests.get(key), namedDests, depth + 1);
  return null;
}

// Where an outline item or link annotation goes: its /Dest, or a GoTo action.
function itemTarget(context, dict, namedDests) {
  if (dict.has(PDFName.of('Dest'))) return destinationPage(context, dict.get(PDFName.of('Dest')), namedDests);
  const action = dict.lookupMaybe(PDFName.of('A'), PDFDict);
  if (action && action.get(PDFName.of('S'))?.toString() === '/GoTo') {
    return destinationPage(context, action.get(PDFName.of('D')), namedDests);
  }
  return null;
}

// Every named destination, from the old catalog /Dests dict and the /Names
// tree, flattened to name -> destination.
function collectNamedDests(doc) {
  const { context, catalog } = doc;
  const out = new Map();
  const oldDests = catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
  if (oldDests) for (const [key, value] of oldDests.entries()) out.set(key.decodeText(), value);
  const walk = (node, depth = 0) => {
    if (!(node instanceof PDFDict) || depth > 32) return;
    const names = node.lookupMaybe(PDFName.of('Names'), PDFArray);
    if (names) {
      for (let i = 0; i + 1 < names.size(); i += 2) {
        const key = nameKey(context.lookup(names.get(i)));
        if (key != null) out.set(key, names.get(i + 1));
      }
    }
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids) for (const kid of kids.asArray()) walk(context.lookup(kid), depth + 1);
  };
  walk(catalog.lookupMaybe(PDFName.of('Names'), PDFDict)?.lookupMaybe(PDFName.of('Dests'), PDFDict));
  return out;
}

// Rewrites named destinations without the ones that land on a cut page.
function pruneNamedDests(doc, namedDests, isCut) {
  const { context, catalog } = doc;
  const keep = [...namedDests.entries()].filter(([, dest]) => !isCut(destinationPage(context, dest, namedDests)));
  const oldDests = catalog.lookupMaybe(PDFName.of('Dests'), PDFDict);
  if (oldDests) {
    for (const [key] of [...oldDests.entries()]) {
      if (isCut(destinationPage(context, oldDests.get(key), namedDests))) oldDests.delete(key);
    }
  }
  const namesDict = catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  if (namesDict?.has(PDFName.of('Dests'))) {
    const fromTree = keep.filter(([key]) => !oldDests?.has(PDFName.of(key)));
    fromTree.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    if (fromTree.length) {
      const flat = [];
      for (const [key, dest] of fromTree) flat.push(PDFHexString.fromText(key), dest);
      namesDict.set(PDFName.of('Dests'), context.obj({ Names: context.obj(flat) }));
    } else {
      namesDict.delete(PDFName.of('Dests'));
    }
  }
}

// Drops bookmarks that open a cut page. A bookmark whose own target is cut
// but that still holds kept children stays as a plain heading.
function pruneOutlines(doc, namedDests, isCut) {
  const { context, catalog } = doc;
  const outlinesRef = catalog.get(PDFName.of('Outlines'));
  const outlines = catalog.lookupMaybe(PDFName.of('Outlines'), PDFDict);
  if (!outlines) return;
  const seen = new Set();
  const countOf = (dict) => {
    const value = dict.lookup(PDFName.of('Count'));
    return typeof value?.asNumber === 'function' ? value.asNumber() : 0;
  };
  // Relinks the kept children of `parent` and returns how many entries show
  // under it when it is open (PDF /Count rules).
  const rebuild = (parentRef, parent, depth = 0) => {
    const kept = [];
    let ref = parent.get(PDFName.of('First'));
    while (ref instanceof PDFRef && !seen.has(ref.toString()) && depth < 64) {
      seen.add(ref.toString());
      const item = context.lookup(ref);
      if (!(item instanceof PDFDict)) break;
      const next = item.get(PDFName.of('Next'));
      const wasClosed = countOf(item) < 0;
      const shown = rebuild(ref, item, depth + 1);
      const targetCut = isCut(itemTarget(context, item, namedDests));
      if (!targetCut || shown > 0) {
        if (targetCut) { item.delete(PDFName.of('Dest')); item.delete(PDFName.of('A')); }
        if (shown > 0) item.set(PDFName.of('Count'), context.obj(wasClosed ? -shown : shown));
        else item.delete(PDFName.of('Count'));
        kept.push({ ref, item, open: shown > 0 && !wasClosed ? shown : 0 });
      }
      ref = next;
    }
    kept.forEach(({ item }, i) => {
      if (parentRef instanceof PDFRef) item.set(PDFName.of('Parent'), parentRef);
      if (i > 0) item.set(PDFName.of('Prev'), kept[i - 1].ref); else item.delete(PDFName.of('Prev'));
      if (i < kept.length - 1) item.set(PDFName.of('Next'), kept[i + 1].ref); else item.delete(PDFName.of('Next'));
    });
    if (kept.length) {
      parent.set(PDFName.of('First'), kept[0].ref);
      parent.set(PDFName.of('Last'), kept[kept.length - 1].ref);
    } else {
      parent.delete(PDFName.of('First'));
      parent.delete(PDFName.of('Last'));
    }
    return kept.reduce((sum, { open }) => sum + 1 + open, 0);
  };
  const shown = rebuild(outlinesRef, outlines);
  if (!shown) catalog.delete(PDFName.of('Outlines'));
  else outlines.set(PDFName.of('Count'), context.obj(shown));
}

// Removes links on kept pages that would jump to a cut page.
function pruneLinks(doc, namedDests, isCut) {
  const { context } = doc;
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    const keep = annots.asArray().filter((ref) => {
      const annot = context.lookup(ref);
      if (!(annot instanceof PDFDict) || annot.get(PDFName.of('Subtype'))?.toString() !== '/Link') return true;
      return !isCut(itemTarget(context, annot, namedDests));
    });
    if (keep.length !== annots.size()) {
      if (keep.length) page.node.set(PDFName.of('Annots'), context.obj(keep));
      else page.node.delete(PDFName.of('Annots'));
    }
  }
}

// Drops form fields whose widgets all sat on cut pages.
function pruneFormFields(doc, keptAnnots) {
  const { context, catalog } = doc;
  const acroForm = catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const fields = acroForm?.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!fields) return;
  const seen = new Set();
  const keepNode = (ref, depth = 0) => {
    if (!(ref instanceof PDFRef) || seen.has(ref.toString()) || depth > 32) return ref instanceof PDFRef ? false : true;
    seen.add(ref.toString());
    const node = context.lookup(ref);
    if (!(node instanceof PDFDict)) return false;
    if (node.get(PDFName.of('Subtype'))?.toString() === '/Widget') return keptAnnots.has(ref.toString());
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (!kids) return true; // a field with no widget at all: nothing on a page to judge by
    const keptKids = kids.asArray().filter((kid) => keepNode(kid, depth + 1));
    if (!keptKids.length) return false;
    if (keptKids.length !== kids.size()) node.set(PDFName.of('Kids'), context.obj(keptKids));
    return true;
  };
  const keptFields = fields.asArray().filter((ref) => keepNode(ref));
  if (keptFields.length !== fields.size()) acroForm.set(PDFName.of('Fields'), context.obj(keptFields));
}

// Last guard: any pointer left to a cut page (page labels, article threads,
// annotation /P, unknown keys) is cleared, so the page cannot stay reachable.
function clearCutPageRefs(doc, isCut) {
  const { context } = doc;
  const seen = new Set();
  const visit = (obj, depth = 0) => {
    if (depth > 200) return;
    if (obj instanceof PDFRef) {
      const key = obj.toString();
      if (seen.has(key)) return;
      seen.add(key);
      visit(context.lookup(obj), depth + 1);
      return;
    }
    const dict = obj instanceof PDFStream ? obj.dict : obj;
    if (dict instanceof PDFDict) {
      for (const [key, value] of [...dict.entries()]) {
        if (value instanceof PDFRef && isCut(value)) dict.delete(key);
        else visit(value, depth + 1);
      }
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i += 1) {
        const value = obj.get(i);
        if (value instanceof PDFRef && isCut(value)) obj.set(i, PDFNull);
        else visit(value, depth + 1);
      }
    }
  };
  visit(context.trailerInfo.Root);
  if (context.trailerInfo.Info) visit(context.trailerInfo.Info);
}

// Drops every object the saved file can no longer reach from its root.
export function dropUnreachableObjects(doc) {
  const { context } = doc;
  const reached = new Set();
  const stack = [context.trailerInfo.Root, context.trailerInfo.Info, context.trailerInfo.Encrypt].filter(Boolean);
  while (stack.length) {
    const obj = stack.pop();
    if (obj instanceof PDFRef) {
      const key = obj.toString();
      if (reached.has(key)) continue;
      reached.add(key);
      const target = context.lookup(obj);
      if (target) stack.push(target);
      continue;
    }
    const dict = obj instanceof PDFStream ? obj.dict : obj;
    if (dict instanceof PDFDict) for (const [, value] of dict.entries()) stack.push(value);
    else if (obj instanceof PDFArray) for (const value of obj.asArray()) stack.push(value);
  }
  let dropped = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reached.has(ref.toString())) { context.delete(ref); dropped += 1; }
  }
  return dropped;
}

/**
 * Keeps only these pages (1-based), in page order. Survey's hidden layer
 * state and page mirror record follow the pages to their new numbers. The cut
 * pages leave the file entirely: their bookmarks, links into them, named
 * destinations, form fields and tag tree go too, and no object of theirs is
 * written.
 */
export async function keepOnlyPages(src, pages) {
  const doc = await PDFDocument.load(await toBytes(src), { ignoreEncryption: true, updateMetadata: false });
  const keep = new Set(pages);
  const allPages = doc.getPages();
  const cut = new Set(allPages.filter((_, i) => !keep.has(i + 1)).map((page) => page.ref.toString()));
  const isCut = (ref) => ref instanceof PDFRef && cut.has(ref.toString());
  if (cut.size) {
    const namedDests = collectNamedDests(doc);
    const keptAnnots = new Set();
    allPages.forEach((page, i) => {
      if (!keep.has(i + 1)) return;
      const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      if (annots) for (const ref of annots.asArray()) if (ref instanceof PDFRef) keptAnnots.add(ref.toString());
    });
    pruneOutlines(doc, namedDests, isCut);
    pruneLinks(doc, namedDests, isCut);
    pruneNamedDests(doc, namedDests, isCut);
    pruneFormFields(doc, keptAnnots);
    const open = doc.catalog.get(PDFName.of('OpenAction'));
    if (open && isCut(destinationPage(doc.context, open, namedDests))) doc.catalog.delete(PDFName.of('OpenAction'));
    // The tag tree and page labels are built around the full page list; the
    // tags of a cut page can also hold its text (ActualText/Alt).
    doc.catalog.delete(PDFName.of('StructTreeRoot'));
    doc.catalog.delete(PDFName.of('PageLabels'));
    doc.catalog.delete(PDFName.of('Threads'));
  }
  for (let i = doc.getPageCount() - 1; i >= 0; i -= 1) {
    if (!keep.has(i + 1)) doc.removePage(i);
  }
  if (cut.size) {
    for (const page of doc.getPages()) { page.node.delete(PDFName.of('StructParents')); page.node.delete(PDFName.of('B')); }
    clearCutPageRefs(doc, isCut);
  }
  const readJson = (key) => {
    try { return JSON.parse(readPdfLibText(doc.catalog.lookup(PDFName.of(key))) || 'null'); } catch { return null; }
  };
  const layerState = readJson(PDF_APP_LAYER_STATE_KEY);
  if (layerState) doc.catalog.set(PDFName.of(PDF_APP_LAYER_STATE_KEY), pdfTextString(JSON.stringify(remapLayerStateToPages(layerState, pages))));
  const presentation = readJson(PRESENTATION_TAG);
  if (presentation) doc.catalog.set(PDFName.of(PRESENTATION_TAG), pdfTextString(JSON.stringify(renumberPageKeys(presentation, pages))));
  if (cut.size) dropUnreachableObjects(doc);
  return doc.save();
}

/**
 * Hands the bytes to the person: the desktop app's Save As, else a download.
 * Returns 'saved' | 'downloaded' | 'canceled'.
 */
export async function deliverPdf(bytes, fileName, { title = 'Export PDF', electronAPI = typeof window !== 'undefined' ? window.electronAPI : null } = {}) {
  if (electronAPI?.saveFile) {
    const result = await electronAPI.saveFile({
      title,
      defaultPath: fileName,
      filters: [{ name: 'PDF files', extensions: ['pdf'] }],
      data: Array.from(new Uint8Array(bytes)),
    });
    if (result?.canceled) return 'canceled';
    if (result?.error) throw new Error(result.error);
    return 'saved';
  }
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return 'downloaded';
}

/**
 * A CSV beside the PDF (export filters' "Comments (.csv)"): the desktop app's
 * Save As, else a download. Returns 'saved' | 'downloaded' | 'canceled'.
 */
export async function deliverCsv(text, fileName, { title = 'Save comments', electronAPI = typeof window !== 'undefined' ? window.electronAPI : null } = {}) {
  // A byte-order mark so Excel reads the names and words as UTF-8.
  const bytes = new TextEncoder().encode(`\uFEFF${text}`);
  if (electronAPI?.saveFile) {
    const result = await electronAPI.saveFile({
      title,
      defaultPath: fileName,
      filters: [{ name: 'CSV files', extensions: ['csv'] }],
      data: Array.from(bytes),
    });
    if (result?.canceled) return 'canceled';
    if (result?.error) throw new Error(result.error);
    return 'saved';
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return 'downloaded';
}
