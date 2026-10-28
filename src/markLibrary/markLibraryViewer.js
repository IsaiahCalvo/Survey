/**
 * markLibraryViewer.js — the browser-only steps the viewer runs to place a
 * library item (PDFViewer placeLibraryItemAt): which page is under the
 * pointer and where on it, and growing text boxes whose {{tokens}} filled in
 * longer than the box.
 */
import { clientPointInPageFrame, pagePresentationFrame } from '../utils/pagePresentation.js';
import { measureTextContentHeight } from '../utils/textContentMeasure.js';
import { growTextBoxToFit } from '../utils/textBoxFit.js';
import { pageElementAt } from './markLibraryPlacement.js';

/**
 * { pageNumber, point } for a placement. `where` is { clientX, clientY } or
 * { center: true } (the middle of `fallbackPage`, the page in view).
 * `sizeFor(pageNumber)` is the page's size in page units ({ width, height }).
 */
export function resolveLibraryDrop(root, where, fallbackPage, sizeFor) {
  if (!where?.center) {
    const page = pageElementAt(root, where?.clientX, where?.clientY);
    if (!page) return null;
    const pageNumber = Number(page.getAttribute('data-page-number'));
    if (!Number.isFinite(pageNumber)) return null;
    const point = clientPointInPageFrame(
      { clientX: where.clientX, clientY: where.clientY },
      pagePresentationFrame(page),
      sizeFor(pageNumber),
    );
    return { pageNumber, point };
  }
  return Number.isFinite(Number(fallbackPage)) && Number(fallbackPage) > 0
    ? { pageNumber: Number(fallbackPage), point: null }
    : null;
}

/** Grow each text box in the clipboard to fit its (token-filled) words. Mutates. */
export function fitPlacedTextBoxes(clipboard) {
  for (const item of clipboard?.items || []) {
    const object = item.kind === 'mark' ? item.object : null;
    const type = String(object?.type || '').toLowerCase();
    if (!object || (type !== 'textbox' && type !== 'i-text' && type !== 'text')) continue;
    if (!(Number(object.height) > 0)) continue;
    const grown = growTextBoxToFit(object, measureTextContentHeight(object));
    object.left = grown.left;
    object.top = grown.top;
    object.height = grown.height;
  }
  return clipboard;
}
