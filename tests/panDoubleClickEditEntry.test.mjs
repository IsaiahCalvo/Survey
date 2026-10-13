import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const viewerSource = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const interactionSource = readFileSync(new URL('../src/hooks/useSVGInteraction.js', import.meta.url), 'utf8');
const overlaySource = readFileSync(new URL('../src/components/TextEditOverlay.jsx', import.meta.url), 'utf8');

test('there is exactly one edit-routing switch, and it lives in annotationEditRoute', () => {
  assert.match(viewerSource, /import \{ resolveEditTypeForAnnotation \} from '\.\/utils\/annotationEditRoute'/);
  // The old inline copy of the type -> editType switch must not come back: a
  // second copy is how Pan-entry and Select-entry drift apart.
  assert.doesNotMatch(viewerSource, /annotationType === 'textbox' \|\| annotationType === 'i-text'/);
  assert.equal(viewerSource.match(/resolveEditTypeForAnnotation\(/g)?.length, 1);
});

test('every edit entry goes through the one dispatcher', () => {
  assert.match(viewerSource, /const requestAnnotationEditEntry = useCallback\(\(request\) => \{/);
  // the SVG layer's native double-click delegates instead of routing itself
  assert.match(
    viewerSource,
    /onRequestEditMode: \(annotationIndex, annotationType, editOptions\) => latest\(\)\.requestAnnotationEditEntry\(\{/,
  );
  // (the per-page handler is identity-stable so the memo'd SVG layer does not
  // re-render on every viewer render — perf 2026-09-30)
  assert.match(viewerSource, /onRequestEditMode=\{getSvgLayerPageHandlers\(pageNumber\)\.onRequestEditMode\}/);
  // callouts still route to the adapter-backed path, now carrying the caret point
  assert.match(
    viewerSource,
    /if \(annotationType === 'callout'\) \{[\s\S]{0,200}handleRequestCalloutEditMode\(annotationIndex, pageNumber, \{ caretAnchor \}\)/,
  );
  // the 300ms dismissal cooldown survived the extraction
  assert.match(viewerSource, /requestAnnotationEditEntry[\s\S]{0,900}Date\.now\(\) - editModeCooldownRef\.current < 300/);
});

test('double-click / double-tap in Pan and Text Select is recognised from pointer events', () => {
  assert.match(viewerSource, /import \{ buildCaretAnchor, createDoubleTapTracker, editEntryKeyForHit, shouldHandleDoubleTapEntry \} from '\.\/utils\/doubleTapEditEntry'/);
  assert.match(viewerSource, /const tracker = createDoubleTapTracker\(\);/);
  // window CAPTURE, mirroring the pan quick-click select effect: the pdf.js
  // scroller preventDefault()s pointerdown, so no native dblclick exists in Pan.
  // Proximity bound only — it pins that THIS effect is the one registering the
  // window-capture pointerup (the pan quick-click effect uses the same handler
  // names earlier in the file). Widened from 6000 on integration: the merged
  // effect also bails on live form widgets and orders candidates by the hit
  // layer's label, so the body is longer. Same claim, same handler. Widened
  // again 2026-10-02: it also notes, per press, whether the text was already
  // selected (Drawboard rule 7: a double-click on unselected text only picks).
  assert.match(viewerSource, /const tracker = createDoubleTapTracker\(\);[\s\S]{0,11000}window\.addEventListener\('pointerup', onUp, true\)/);
  assert.match(viewerSource, /window\.addEventListener\('pointercancel', onCancel, true\)/);
  // a gesture that moved is a pan / marquee / text drag and is discarded
  assert.match(viewerSource, /const slop = event\.pointerType === 'touch' \? 12 : 6;[\s\S]{0,200}tracker\.reset\(\); return;/);
  // only the read/select family opens editors on a double gesture
  assert.match(viewerSource, /if \(!\['pan', 'select', 'text-select'\]\.includes\(tool\)\)/);
});

test('both taps\' targets are tried, so an overlap cannot swallow the gesture', () => {
  // Pan hand-walks SVG geometry; Select reads the real hit targets; over
  // overlapping annotations the two disagree, in both directions (observed live
  // on desktop AND mobile). The dispatcher answers false for anything with no
  // editor, so trying both can only land on a real target.
  assert.match(viewerSource, /const candidates = \[hit, target\]\.filter\(/);
  assert.match(viewerSource, /for \(const candidate of candidates\) \{[\s\S]{0,1600}if \(opened\) break;/);
});

test('the tool the gesture started in stays armed (Drawboard parity)', () => {
  // in a microtask so it is the LAST setActiveTool for this gesture — the pan
  // quick-click effect can re-run on the second tap with a stale closure
  assert.match(viewerSource, /if \(firstTapTool === 'pan'\) queueMicrotask\(\(\) => setActiveTool\('pan'\)\);/);
});

test('the caret lands where the double-click landed', () => {
  assert.match(interactionSource, /function readCaretAnchor\(event\)/);
  assert.match(interactionSource, /onRequestEditMode\(calloutId, 'callout', \{ caretAnchor: readCaretAnchor\(e\) \}\)/);
  assert.match(interactionSource, /onRequestEditMode\(index, annotation\.type, \{ caretAnchor: readCaretAnchor\(e\) \}\)/);
  assert.match(viewerSource, /caretAnchor=\{editingAnnotation\.caretAnchor \|\| null\}/);
  assert.match(overlaySource, /function caretRangeAt\(el, point\)/);
  assert.match(overlaySource, /document\.caretRangeFromPoint\(point\.x, point\.y\)/);
  assert.match(overlaySource, /document\.caretPositionFromPoint\(point\.x, point\.y\)/);
  // a native caret API answer from OUTSIDE this editor (the pdf.js text layer
  // sits above it under Text Select) falls through to our own glyph geometry,
  // never to some other element's text node
  assert.match(overlaySource, /if \(!range \|\| !el\.contains\(range\.startContainer\)\) \{[\s\S]{0,400}return caretRangeByGeometry\(el, point\);/);
  assert.match(overlaySource, /function caretRangeByGeometry\(el, point\)/);
  assert.match(overlaySource, /function caretPointFor\(el, anchor\)/);
  // the caret must be placed AFTER layout settles — a same-tick
  // caretRangeFromPoint resolves against the pre-positioned box and always
  // answers offset 0 (observed live 2026-09-15)
  assert.match(overlaySource, /caretFrame = requestAnimationFrame\(\(\) => placeCaret\(0\)\);/);
  assert.match(overlaySource, /if \(attempt < 3\) caretFrame = requestAnimationFrame\(\(\) => placeCaret\(attempt \+ 1\)\);/);
  // and select-all is still the standing fallback on every failure path
  assert.match(overlaySource, /sel\?\.addRange\(selectAllRange\(el\)\);/);
  assert.match(overlaySource, /if \(caretFrame\) cancelAnimationFrame\(caretFrame\);/);
});

test('the caret anchor is stored relative to the annotation box, not the viewport', () => {
  // Opening the editor can scroll the page; a raw client point then lands
  // outside the editor (observed live under Text Select, 500px off).
  assert.match(viewerSource, /const caretAnchor = buildCaretAnchor\(\{/);
  assert.match(viewerSource, /host: document\.querySelector\(`\[data-diag-svg-wrapper="\$\{candidate\.pageNumber\}"\] \$\{hostSelector\}`\)/);
  assert.match(interactionSource, /host: event\?\.target\?\.closest\?\.\('\[data-callout-id\], \[data-annotation-index\]'\)/);
  assert.match(overlaySource, /resolveCaretAnchorPoint\(anchor, rect\)/);
});

test('the text editor commits on a click-away even while Pan is armed', () => {
  // pdf.js preventDefault()s pointerdown while panning, which suppresses the
  // compatibility mouse events — a mousedown-only listener never fired and the
  // editor stayed open (observed live 2026-09-15).
  assert.match(overlaySource, /document\.addEventListener\('pointerdown', onDocPointerDown, true\);/);
  assert.match(overlaySource, /document\.addEventListener\('mousedown', onDocPointerDown, true\);/);
  assert.match(overlaySource, /document\.removeEventListener\('pointerdown', onDocPointerDown, true\);/);
});
