/**
 * historyMergeNormalize.js — tidy a mark after a field-level Undo/Redo merge.
 *
 * Undo/Redo writes only the fields your action changed onto the mark as it is
 * now (see annotationLocalHistory.js). When a collaborator changed other
 * fields meanwhile, the merged mark is a state neither snapshot had, so
 * anything DERIVED from several fields must be recomputed:
 *
 *  - A callout's drawn parts (leader lines, box, text children) come from its
 *    data.legacyCallout, so the callout is re-projected from that payload.
 *  - A text box's / callout's box height is only right for the text and font
 *    it was measured with. If the merge left a height from one state with text
 *    or a font from another (you undo 12 -> 24pt, which had grown the box, after
 *    someone typed four more lines), the renderers — which trust the stored
 *    height and clip what does not fit — would cut the text off. So when the
 *    merged text/font differs from the snapshot the step restores, the box is
 *    refitted with the text bar's rule (owner Test 44, 2026-10-06): it fits the
 *    text both ways (never under one line), and a callout's box moves away
 *    from its leader - the knee and tip never move (KAL-30).
 */
import {
  calloutToAnnotationObject,
  deriveCalloutsFromByPage,
} from './calloutAnnotationBridge.js';
import { refitCalloutToText, refitTextboxToText } from './selectedTextFormatting.js';

const FALLBACK_PAGE_SIZE = { width: 612, height: 792 };

const TEXTBOX_LAYOUT_KEYS = ['text', 'fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'lineHeight', 'width', 'scaleX'];
const CALLOUT_STYLE_LAYOUT_KEYS = ['fontSize', 'fontFamily', 'bold', 'italic', 'lineHeight'];

const same = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

function textboxLayoutDiffers(merged, target) {
  return TEXTBOX_LAYOUT_KEYS.some((key) => !same(merged?.[key], target?.[key]));
}

function calloutLayoutDiffers(merged, target) {
  if (!same(merged?.text, target?.text) || !same(merged?.textBoxWidth, target?.textBoxWidth)) return true;
  return CALLOUT_STYLE_LAYOUT_KEYS.some((key) => !same(merged?.style?.[key], target?.style?.[key]));
}

/**
 * @param {object} object the merged fabric object
 * @param {object} target the snapshot the step restores (entry.after)
 * @param {object} options
 * @param {number} options.pageNumber
 * @param {{width:number,height:number}} [options.pageSize] unscaled page size
 * @param {(request: object) => number|null} [options.measure] text layout
 *   measurer (measureTextLayoutHeight in the browser); without it no refit runs
 */
export function normalizeMergedHistoryObject(object, target, { pageNumber, pageSize, measure } = {}) {
  if (!object || typeof object !== 'object') return object;
  if (object?.data?.type === 'callout' && object?.data?.legacyCallout) {
    try {
      const page = Number(pageNumber);
      const size = pageSize && Number.isFinite(pageSize.width) && Number.isFinite(pageSize.height)
        ? pageSize
        : FALLBACK_PAGE_SIZE;
      let callout = deriveCalloutsFromByPage({ [page]: { objects: [object] } })[0];
      if (!callout) return object;
      if (calloutLayoutDiffers(callout, target?.data?.legacyCallout)) {
        callout = refitCalloutToText(callout, size, measure);
      }
      return calloutToAnnotationObject(callout, size);
    } catch (_err) {
      return object;
    }
  }
  if (String(object.type || '').toLowerCase() === 'textbox' && textboxLayoutDiffers(object, target)) {
    return refitTextboxToText(object, measure);
  }
  return object;
}
