// The executors behind the annotation agent tools. Each one runs on the open
// document (the PDFViewer bridge registered via registerAgentDocument) with the
// same writes a human tap makes. The tool schemas/access live in the shared
// spec (supabase/functions/_shared/annotationAgentSpec.js) so the voice edge
// function and the WebMCP layer describe the same tools; this file attaches the
// run-on-the-document half. Mirrors surveyAgentTools.js.

import { ANNOTATION_TOOL_SPECS } from '../../supabase/functions/_shared/annotationAgentSpec.js';

// Finish an add message, appending the new annotation's id when the document
// reports one. The id lets a caller (e.g. the voice agent's per-turn Undo) take
// the add back with survey_delete_annotation. Omitted cleanly when absent.
const added = (base, res) => (res?.id ? `${base} (id ${res.id}).` : `${base}.`);

// Build the shape (rectangle/ellipse) executor: both share one body, keyed by
// the builder shape name and the word used in messages.
function shapeExecutor({ getDocument, builderShape, word }) {
  return async ({ page, x, y, width, height, stroke_color: strokeColor, fill_color: fillColor, stroke_width: strokeWidth }) => {
    const doc = getDocument();
    const size = doc.getPageSize(Number(page));
    if (!size) throw new Error('That page is not in the open document.');
    if (!(Number(width) > 0) || !(Number(height) > 0)
      || Number(x) < 0 || Number(y) < 0
      || Number(x) + Number(width) > size.width || Number(y) + Number(height) > size.height) {
      throw new Error(`The ${word} must fit inside the page (${size.width} x ${size.height} points).`);
    }
    const res = doc.addShape({ page: Number(page), shape: builderShape, x: Number(x), y: Number(y), width: Number(width), height: Number(height), strokeColor, fillColor, strokeWidth: strokeWidth == null ? undefined : Number(strokeWidth) });
    if (res?.reason === 'off-page' || res?.reason === 'too-small') throw new Error(`The ${word} must fit inside the page (${size.width} x ${size.height} points).`);
    if (res?.reason === 'locked') throw new Error(`A locked annotation on that page blocked the save, so the ${word} was not added.`);
    if (!res?.ok) throw new Error(`Could not add the ${word}.`);
    return added(`Added a ${word} on page ${page}`, res);
  };
}

// Returns the annotation tools (schema from the shared spec, execute attached
// here) ready to splice into the WebMCP tool list. `text` wraps a value as MCP
// text content for the one read tool; `getDocument` resolves the open document.
export function buildAnnotationTools({ getDocument, text }) {
  const executors = {
    survey_list_annotations: async () => {
      const doc = getDocument();
      return text(typeof doc.listAnnotations === 'function' ? doc.listAnnotations() : []);
    },
    survey_add_text_note: async ({ page, x, y, text: noteText, width, color }) => {
      const doc = getDocument();
      if (!String(noteText || '').trim()) throw new Error('The note text is empty.');
      const size = doc.getPageSize(Number(page));
      if (!size) throw new Error('That page is not in the open document.');
      if (Number(x) < 0 || Number(y) < 0 || Number(x) >= size.width || Number(y) >= size.height) {
        throw new Error(`The note must start inside the page (${size.width} x ${size.height} points).`);
      }
      const res = doc.addTextNote({ page: Number(page), x: Number(x), y: Number(y), width: width == null ? undefined : Number(width), text: String(noteText), color });
      if (res?.reason === 'off-page') throw new Error(`The note must start inside the page (${size.width} x ${size.height} points).`);
      if (res?.reason === 'locked') throw new Error('A locked annotation on that page blocked the save, so the note was not added.');
      if (!res?.ok) throw new Error('Could not add the note.');
      return added(`Added a text note on page ${page}`, res);
    },
    survey_edit_text_note: async ({ annotation_id: annotationId, text: noteText }) => {
      const doc = getDocument();
      if (!String(noteText || '').trim()) throw new Error('The note text is empty.');
      const res = doc.editTextNote(annotationId, { text: String(noteText) });
      if (res?.reason === 'not-found') throw new Error(`No annotation with id ${annotationId}. Use survey_list_annotations.`);
      if (res?.reason === 'not-a-text-note') throw new Error('That annotation is not a text note, so its text cannot be changed.');
      if (res?.reason === 'not-allowed') throw new Error('This person cannot change that note (it belongs to someone else or is locked), so nothing changed.');
      if (res?.reason === 'locked') throw new Error('A locked annotation blocked the change, so nothing changed.');
      if (!res?.ok) throw new Error('Could not edit that note.');
      return 'Changed the note text.';
    },
    survey_delete_annotation: async ({ annotation_id: annotationId, confirm }) => {
      const doc = getDocument();
      const found = typeof doc.findAnnotation === 'function' ? doc.findAnnotation(annotationId) : null;
      if (!found) throw new Error(`No annotation with id ${annotationId}. Use survey_list_annotations.`);
      if (confirm !== true) {
        return `Not deleted. Ask the person to confirm, then call again with confirm: true to remove annotation ${annotationId}.`;
      }
      const res = doc.deleteAnnotation(annotationId);
      if (res?.reason === 'not-found') throw new Error(`No annotation with id ${annotationId}.`);
      if (res?.reason === 'not-allowed') throw new Error('This person cannot delete that annotation (it belongs to someone else or is locked), so nothing was deleted.');
      if (res?.reason === 'locked') throw new Error('A locked annotation blocked the delete, so nothing was removed.');
      if (!res?.ok) throw new Error('Could not delete that annotation.');
      return `Deleted annotation ${annotationId}. One Undo restores it.`;
    },
    survey_add_rectangle: shapeExecutor({ getDocument, builderShape: 'rect', word: 'rectangle' }),
    survey_add_ellipse: shapeExecutor({ getDocument, builderShape: 'ellipse', word: 'ellipse' }),
    survey_add_line: async ({ page, x1, y1, x2, y2, arrow, stroke_color: strokeColor, stroke_width: strokeWidth }) => {
      const doc = getDocument();
      const size = doc.getPageSize(Number(page));
      if (!size) throw new Error('That page is not in the open document.');
      const inPage = (px, py) => Number(px) >= 0 && Number(py) >= 0 && Number(px) <= size.width && Number(py) <= size.height;
      if (!inPage(x1, y1) || !inPage(x2, y2)) throw new Error(`Both ends must be inside the page (${size.width} x ${size.height} points).`);
      const res = doc.addLine({ page: Number(page), x1: Number(x1), y1: Number(y1), x2: Number(x2), y2: Number(y2), arrow: arrow === true, strokeColor, strokeWidth: strokeWidth == null ? undefined : Number(strokeWidth) });
      if (res?.reason === 'too-small') throw new Error('The line is too short to draw (make the two points at least a few points apart).');
      if (res?.reason === 'off-page') throw new Error(`Both ends must be inside the page (${size.width} x ${size.height} points).`);
      if (res?.reason === 'locked') throw new Error('A locked annotation on that page blocked the save, so the line was not added.');
      if (!res?.ok) throw new Error('Could not add the line.');
      return added(`Added a ${arrow === true ? 'arrow' : 'line'} on page ${page}`, res);
    },
    survey_add_polygon: async ({ page, points, closed, stroke_color: strokeColor, fill_color: fillColor, stroke_width: strokeWidth }) => {
      const doc = getDocument();
      const size = doc.getPageSize(Number(page));
      if (!size) throw new Error('That page is not in the open document.');
      if (!Array.isArray(points) || points.some((p) => !p || !(Number(p.x) >= 0) || !(Number(p.y) >= 0) || Number(p.x) > size.width || Number(p.y) > size.height)) {
        throw new Error(`Every point must be inside the page (${size.width} x ${size.height} points).`);
      }
      const minimum = closed === false ? 2 : 3;
      if (points.length < minimum) throw new Error(`A ${closed === false ? 'polyline needs at least 2' : 'polygon needs at least 3'} points.`);
      const res = doc.addPolygon({ page: Number(page), points, closed: closed !== false, strokeColor, fillColor, strokeWidth: strokeWidth == null ? undefined : Number(strokeWidth) });
      if (res?.reason === 'too-few-points') throw new Error(`A ${closed === false ? 'polyline needs at least 2' : 'polygon needs at least 3'} points.`);
      if (res?.reason === 'off-page') throw new Error(`Every point must be inside the page (${size.width} x ${size.height} points).`);
      if (res?.reason === 'locked') throw new Error('A locked annotation on that page blocked the save, so the shape was not added.');
      if (!res?.ok) throw new Error('Could not add the shape.');
      return added(`Added a ${closed === false ? 'polyline' : 'polygon'} on page ${page}`, res);
    },
    survey_add_callout: async ({ page, text: calloutText, arrow_x: arrowX, arrow_y: arrowY, box_x: boxX, box_y: boxY, box_width: boxWidth, stroke_color: strokeColor, fill_color: fillColor }) => {
      const doc = getDocument();
      if (!String(calloutText || '').trim()) throw new Error('The callout text is empty.');
      const size = doc.getPageSize(Number(page));
      if (!size) throw new Error('That page is not in the open document.');
      const inPage = (px, py) => Number(px) >= 0 && Number(py) >= 0 && Number(px) <= size.width && Number(py) <= size.height;
      if (!inPage(arrowX, arrowY) || !inPage(boxX, boxY)) throw new Error(`The arrow point and the box corner must be inside the page (${size.width} x ${size.height} points).`);
      const res = doc.addCallout({ page: Number(page), text: String(calloutText), arrowX: Number(arrowX), arrowY: Number(arrowY), boxX: Number(boxX), boxY: Number(boxY), boxWidth: boxWidth == null ? undefined : Number(boxWidth), strokeColor, fillColor });
      if (res?.reason === 'empty') throw new Error('The callout text is empty.');
      if (res?.reason === 'off-page') throw new Error(`The arrow point and the box corner must be inside the page (${size.width} x ${size.height} points).`);
      if (!res?.ok) throw new Error('Could not add the callout.');
      return added(`Added a callout on page ${page}`, res);
    },
    survey_add_highlight: async ({ page, search_text: searchText, color, opacity, occurrence }) => {
      const doc = getDocument();
      if (!String(searchText || '').trim()) throw new Error('The text to highlight is empty.');
      const size = doc.getPageSize(Number(page));
      if (!size) throw new Error('That page is not in the open document.');
      const res = await doc.addHighlight({ page: Number(page), searchText: String(searchText), color, opacity: opacity == null ? undefined : Number(opacity), occurrence: occurrence == null ? undefined : Number(occurrence) });
      if (res?.reason === 'empty') throw new Error('The text to highlight is empty.');
      if (res?.reason === 'no-text') throw new Error('That page has no readable text to highlight. A scanned page needs text recognition run on it first.');
      if (res?.reason === 'no-match') throw new Error('Could not find that text on the page. Check the words and the page number.');
      if (res?.reason === 'locked') throw new Error('A locked annotation on that page blocked the save, so the highlight was not added.');
      if (!res?.ok) throw new Error('Could not add the highlight.');
      return added(`Highlighted "${searchText}" on page ${page}`, res);
    },
    survey_edit_callout: async ({ annotation_id: annotationId, text: calloutText, stroke_color: strokeColor, fill_color: fillColor }) => {
      const doc = getDocument();
      if (calloutText == null && !strokeColor && !fillColor) throw new Error('Give the new text, a stroke_color or a fill_color.');
      const res = doc.editCallout(annotationId, { text: calloutText, strokeColor, fillColor });
      if (res?.reason === 'not-found') throw new Error(`No callout with id ${annotationId}. Use survey_list_annotations.`);
      if (res?.reason === 'empty') throw new Error('Nothing to change: give the new text, a stroke_color or a fill_color.');
      if (res?.reason === 'not-allowed') throw new Error('This person cannot change that callout (it belongs to someone else or is locked), so nothing changed.');
      if (res?.reason === 'locked') throw new Error('That callout is locked, so nothing changed.');
      if (!res?.ok) throw new Error('Could not edit that callout.');
      return 'Changed the callout.';
    },
    survey_recolor_highlight: async ({ annotation_id: annotationId, color, opacity }) => {
      const doc = getDocument();
      if (color == null && opacity == null) throw new Error('Give a color or an opacity to change.');
      const res = doc.recolorHighlight(annotationId, { color, opacity: opacity == null ? undefined : Number(opacity) });
      if (res?.reason === 'not-found') throw new Error(`No annotation with id ${annotationId}. Use survey_list_annotations.`);
      if (res?.reason === 'not-a-highlight') throw new Error('That annotation is not a highlight, so it cannot be recolored.');
      if (res?.reason === 'empty' || res?.reason === 'no-change') throw new Error('Give a color or an opacity to change.');
      if (res?.reason === 'not-allowed') throw new Error('This person cannot change that highlight (it belongs to someone else or is locked), so nothing changed.');
      if (res?.reason === 'locked') throw new Error('A locked annotation blocked the change, so nothing changed.');
      if (!res?.ok) throw new Error('Could not recolor that highlight.');
      return 'Changed the highlight.';
    },
  };
  return ANNOTATION_TOOL_SPECS.map((spec) => ({ ...spec, execute: executors[spec.name] }));
}
