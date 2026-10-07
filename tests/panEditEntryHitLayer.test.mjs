/**
 * Pan/Select edit-entry hit layer — mount + gating guards.
 *
 * Drawboard PDF has no modal view-vs-edit split: Pan IS a selection mode, and a
 * double-click on a text box or callout opens the same editor from Pan as from
 * Select. To make that reachable, every editor-bearing carrier is LABELLED in
 * Pan (data-edit-entry-kind / data-pan-edit-entry) — but NOT armed for pointer
 * input, because Drawboard also pans from an unselected annotation.
 *
 * These tests pin both halves:
 *   1. the type→editor mapping lives in exactly one module, and
 *   2. arming the labels never arms pointer events (the pan-drag safety net).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

import {
  isEditEntryAnnotation,
  normalizeAnnotationEditType,
  resolveEditEntryKind,
  resolveEditTypeForAnnotation,
} from '../src/utils/annotationEditRoute.js';

// INTEGRATION NOTE (2026-09-15, claude/edit-modes-integration): this slice and
// the double-click slice each landed their own copy of annotationEditRoute with
// the same rules but different shapes — a bare 'text' | 'bbox' | null here, a
// { annotationType, isCounter, editType, skipReason } record there (its
// dispatcher needs the skip reason for its diagnostics and a caller-supplied
// raw type). One module cannot have two shapes, so the record won and the
// assertions below read `.editType`. Same rules, same coverage: nothing here
// was relaxed, only re-spelled. Same reason `normalizeAnnotationTypeForEdit`
// is now `normalizeAnnotationEditType` — one name for one function.

const svgSource = await readFile(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
const viewerSource = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const containerSource = await readFile(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
const hitTestSource = await readFile(new URL('../src/utils/annotationHitTest.js', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// 1. The extracted type→editor mapping matches the rules it replaced
// ---------------------------------------------------------------------------

test('resolveEditTypeForAnnotation reproduces the double-click routing rules', () => {
  // text opens the inline text editor
  for (const type of ['text', 'textbox', 'i-text']) {
    assert.equal(resolveEditTypeForAnnotation({ type }).editType, 'text', type);
  }
  // fabric 7 serializes capitalized class names; 'IText' must not fall through
  assert.equal(resolveEditTypeForAnnotation({ type: 'Textbox' }).editType, 'text');
  assert.equal(resolveEditTypeForAnnotation({ type: 'IText' }).editType, 'text');

  // line / arrow / polygon / polyline open the uniform bbox editor
  for (const type of ['line', 'polygon', 'polyline']) {
    assert.equal(resolveEditTypeForAnnotation({ type }).editType, 'bbox', type);
  }
  // a counter keeps the bbox editor even though its base type is a shape
  assert.equal(resolveEditTypeForAnnotation({ type: 'rect', data: { type: 'counter' } }).editType, 'bbox');
  assert.equal(resolveEditTypeForAnnotation({ type: 'circle', data: { type: 'counter' } }).editType, 'bbox');

  // pen / highlighter strokes and plain shapes have no second-level editor
  for (const type of ['path', 'Path', 'rect', 'circle', 'ellipse', 'triangle']) {
    assert.equal(resolveEditTypeForAnnotation({ type }).editType, null, type);
  }
  // unknown types are an explicit no-op, never a callout fallthrough (KAL-125)
  assert.equal(resolveEditTypeForAnnotation({ type: 'image' }).editType, null);
  assert.equal(resolveEditTypeForAnnotation({ type: 'stamp' }).editType, null);
  assert.equal(resolveEditTypeForAnnotation(null).editType, null);
  assert.equal(resolveEditTypeForAnnotation({}).editType, null);
});

test('normalizeAnnotationEditType folds fabric 7 class names onto app types', () => {
  assert.equal(normalizeAnnotationEditType('IText'), 'i-text');
  assert.equal(normalizeAnnotationEditType('itext'), 'i-text');
  assert.equal(normalizeAnnotationEditType('Textbox'), 'textbox');
  assert.equal(normalizeAnnotationEditType(undefined), '');
});

test('resolveEditEntryKind labels only carriers that actually open an editor', () => {
  assert.equal(resolveEditEntryKind({ type: 'textbox' }), 'text');
  assert.equal(resolveEditEntryKind({ type: 'IText' }), 'text');
  assert.equal(resolveEditEntryKind({ type: 'rect', data: { type: 'counter' } }), 'counter');
  assert.equal(resolveEditEntryKind({ type: 'line' }), 'line');
  assert.equal(resolveEditEntryKind({ type: 'polygon' }), 'poly');
  assert.equal(resolveEditEntryKind({ type: 'polyline' }), 'poly');
  assert.equal(resolveEditEntryKind({ type: 'path' }), null);
  assert.equal(resolveEditEntryKind({ type: 'rect' }), null);
  assert.equal(resolveEditEntryKind({ type: 'ellipse' }), null);
  assert.equal(resolveEditEntryKind(null), null);

  assert.equal(isEditEntryAnnotation({ type: 'textbox' }), true);
  assert.equal(isEditEntryAnnotation({ type: 'rect' }), false);
});

test('PDFViewer routes double-click edit mode through the shared helper, not a second switch', () => {
  assert.match(viewerSource, /import \{ resolveEditTypeForAnnotation \} from '\.\/utils\/annotationEditRoute';/);
  // Integration: the call moved into requestAnnotationEditEntry, the single
  // dispatcher both edit entries (native double-click and the double-tap
  // recogniser) now share, and it passes the caller's raw type through.
  assert.match(viewerSource, /const route = resolveEditTypeForAnnotation\(annotationData, annotationType\);/);
  // Exactly one call site — a second one is how the entries drift apart.
  assert.equal(viewerSource.match(/resolveEditTypeForAnnotation\(/g)?.length, 1);
  // The inline copy of the mapping must be gone so the entry points cannot drift.
  assert.equal(viewerSource.includes("let editType;"), false);
});

// ---------------------------------------------------------------------------
// 2. Mounting the labels must never arm pointer input (pan-drag safety)
// ---------------------------------------------------------------------------

test('the edit-entry hit layer mounts in Pan and in every Select mode', () => {
  assert.match(svgSource, /panEditEntryEnabled = false,/);
  assert.match(svgSource, /const editEntryTargetsMounted = isSelectTool \|\| panEditEntryEnabled;/);
  assert.match(viewerSource, /panEditEntryEnabled=\{activeTool === 'pan'\}/);
  // Both carriers are stamped: per-annotation wrapper and the callout wrap <g>.
  assert.match(svgSource, /data-edit-entry-kind=\{editEntryKind \|\| undefined\}/);
  assert.match(svgSource, /data-pan-edit-entry=\{editEntryKind \? 'true' : undefined\}/);
  assert.match(svgSource, /data-edit-entry-kind=\{editEntryTargetsMounted \? 'callout' : undefined\}/);
  assert.match(svgSource, /data-pan-edit-entry=\{editEntryTargetsMounted \? 'true' : undefined\}/);
  // isSelectTool already covers rectangle, lasso and Text Select.
  // 2026-10-02 (Drawboard rule 3/4): the same gate also opens while a press
  // on the selection is in hand under another tool (selectionGrabArmed), so
  // the pin stops at the select-family half of the condition.
  assert.match(svgSource, /const isSelectTool = \(activeTool === 'select' \|\| activeTool === 'text-select'/);
});

test('Pan still owns every drag: no pointer-events gate learns about panEditEntryEnabled', () => {
  // The annotation hit targets stay select-only. If this ever ORs in
  // panEditEntryEnabled, a drag begun on an annotation stops panning.
  assert.match(svgSource, /const annotationHitTargetsInteractive = isSelectTool && \(\s*\n\s*activeTool !== 'text-select' \|\| textSelectManipulationArmed\s*\n\s*\);/);
  // The SVG root stays inert outside select/creation tools, so blank-pixel
  // panning (and panning over an annotation) still reaches the pdf.js scroller.
  assert.match(svgSource, /pointerEvents: isInteractive && \(\s*\n\s*activeTool !== 'text-select' \|\| textSelectManipulationArmed \|\| interactionState !== 'idle'\s*\n\s*\) \? 'auto' : 'none',/);
  assert.match(svgSource, /const isInteractive = isSelectTool \|\| isCreationTool;/);
  // PDFViewer's wrapper-level select handlers stay select-only too.
  assert.match(viewerSource, /const svgInteractive = activeTool === 'select' \|\| activeTool === 'text-select';/);

  // No pointer-events gate may consult the pan flag. Outside comments the only
  // legal uses are the prop declaration, the mount flag and the dblclick seam.
  // A fourth use is the signal to re-read this test before shipping.
  const svgCode = svgSource
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  const panFlagUses = svgCode.match(/panEditEntryEnabled/g) || [];
  assert.deepEqual(
    svgCode.split('\n').filter((line) => line.includes('panEditEntryEnabled')).map((line) => line.trim()),
    [
      'panEditEntryEnabled = false,',
      'const editEntryTargetsMounted = isSelectTool || panEditEntryEnabled;',
      "onDoubleClick={(isSelectTool || panEditEntryEnabled) ? handleAnnotationDoubleClick : undefined}",
    ],
  );
  assert.equal(panFlagUses.length, 3);
});

test('annotation carriers never claim the pan-escape marker', () => {
  // `data-pan-interactive="true"` means "Pan must not preventDefault here".
  // Putting it on an annotation would stop a drag over that annotation from
  // panning — the opposite of Drawboard, where an unselected shape pans.
  // 2026-10-02 (Drawboard rule 3): the ONE use is the page <svg> while a press
  // on the current SELECTION is in hand under Pan (that press moves the
  // selected mark). No annotation carrier ever carries it.
  assert.equal((svgSource.match(/data-pan-interactive=/g) || []).length, 1);
  assert.match(svgSource, /data-pan-interactive=\{selectionGrabArmed \? 'true' : undefined\}/);
  assert.match(containerSource, /data-pan-interactive="true"/);
});

test('the double-click seam is armed in Pan as well as Select', () => {
  assert.match(
    svgSource,
    /onDoubleClick=\{\(isSelectTool \|\| panEditEntryEnabled\) \? handleAnnotationDoubleClick : undefined\}/,
  );
});

// ---------------------------------------------------------------------------
// 3. Form widgets: live in Pan and in every Select mode
// ---------------------------------------------------------------------------

test('form widgets stay interactive in Pan and in every Select mode', () => {
  assert.match(
    viewerSource,
    /interactive=\{activeTool === 'pan' \|\| activeTool === 'select' \|\| activeTool === 'text-select'\}\n\s*persistedValues=\{pageFormFieldValues\}/,
  );
});

test('Pan does not swallow a pointer or touch that lands on a live form widget', () => {
  // INTEGRATION (2026-09-15): this slice inlined the widget selector here while
  // the forms slice extracted it to utils/formWidgetPointerTargets. The helper
  // won — one definition, not two drifting selectors — so both halves of the
  // bail-out are asserted separately instead of as one literal. Strictly more
  // than before: it now also pins that the shared helper is the thing consulted.
  const escapeMarker = /\[data-pan-interactive="true"\]/;
  // Desktop: the scroller's pointerdown preventDefault would kill focus/click.
  const panPointerDown = containerSource.match(
    /const onPointerDown = \(event\) => \{[\s\S]*?event\.preventDefault\(\);/,
  );
  assert.ok(panPointerDown, 'pan pointerdown handler not found');
  assert.match(panPointerDown[0], /isLiveFormWidgetTarget\(event\.target\)/);
  assert.match(panPointerDown[0], escapeMarker);
  // Mobile: touchstart preventDefault would stop the field ever focusing.
  const nativeTargetFn = containerSource.match(
    /const isNativeInteractionTarget = \(target\) => \{[\s\S]*?\n\s*\};/,
  );
  assert.ok(nativeTargetFn, 'isNativeInteractionTarget not found');
  assert.match(nativeTargetFn[0], /isLiveFormWidgetTarget\(nativeTarget\)/);
  assert.match(nativeTargetFn[0], escapeMarker);
  // and the single definition of "this pointer belongs to a form control"
  assert.match(containerSource, /import \{ isLiveFormWidgetTarget \} from '\.\.\/utils\/formWidgetPointerTargets\.js'/);
});

// ---------------------------------------------------------------------------
// 4. resolveAnnotationAt surfaces the label so one hit-test answers "which editor"
// ---------------------------------------------------------------------------

test('resolveAnnotationAt returns editEntryKind in its result shape', () => {
  assert.match(hitTestSource, /return \{ pageNumber, annotationIndex, calloutId, kind, groupIndices, editEntryKind \};/);
});

const withDom = async (html, run) => {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const prevWindow = global.window;
  const prevDocument = global.document;
  global.window = dom.window;
  global.document = dom.window.document;
  try {
    return await run(dom.window.document);
  } finally {
    global.window = prevWindow;
    global.document = prevDocument;
    dom.window.close();
  }
};

const stubRect = (el, rect) => {
  el.getBoundingClientRect = () => ({
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
  });
};

test('a pointer event over a stamped text box reports its edit-entry kind', async () => {
  await withDom(
    `<!doctype html><div id="viewer_pageDiv_0">
       <div data-diag-svg-wrapper="1">
         <svg><g data-annotation-index="4" data-edit-entry-kind="text" data-pan-edit-entry="true">
           <rect id="hit"></rect>
         </g></svg>
       </div>
     </div>`,
    async (document) => {
      const { resolveAnnotationAt } = await import('../src/utils/annotationHitTest.js');
      const hit = document.getElementById('hit');
      const carrier = hit.closest('[data-annotation-index]');
      const pageDiv = document.getElementById('viewer_pageDiv_0');
      const result = resolveAnnotationAt({
        clientX: 50,
        clientY: 50,
        composedPath: () => [hit, carrier, carrier.parentNode, pageDiv],
      });
      assert.equal(result.kind, 'annotation');
      assert.equal(result.annotationIndex, 4);
      assert.equal(result.pageNumber, 1);
      assert.equal(result.editEntryKind, 'text');
    },
  );
});

test('a callout resolves its edit-entry kind from the wrap group above the callout id', async () => {
  await withDom(
    `<!doctype html><div id="viewer_pageDiv_0">
       <div data-diag-svg-wrapper="1">
         <svg><g data-edit-entry-kind="callout" data-pan-edit-entry="true">
           <g id="cal" data-callout-id="c-1"></g>
         </g></svg>
       </div>
     </div>`,
    async (document) => {
      const { resolveAnnotationAt } = await import('../src/utils/annotationHitTest.js');
      const pageDiv = document.getElementById('viewer_pageDiv_0');
      const wrapper = document.querySelector('[data-diag-svg-wrapper="1"]');
      const calloutGroup = document.getElementById('cal');
      const box = { left: 0, top: 0, right: 200, bottom: 200 };
      stubRect(pageDiv, box);
      stubRect(wrapper, box);
      stubRect(calloutGroup, { left: 20, top: 20, right: 120, bottom: 90 });
      // No composed path: this is the pan-mode fallback, where the SVG layer is
      // pointer-inert and the carrier is found by walking the page's DOM.
      document.elementsFromPoint = () => [pageDiv];
      const result = resolveAnnotationAt({
        clientX: 50,
        clientY: 50,
        composedPath: () => [],
      });
      assert.equal(result.kind, 'callout');
      assert.equal(result.calloutId, 'c-1');
      assert.equal(result.editEntryKind, 'callout');
    },
  );
});

test('blank page under the pan fallback reports no edit entry', async () => {
  await withDom(
    `<!doctype html><div id="viewer_pageDiv_0">
       <div data-diag-svg-wrapper="1">
         <svg><g data-annotation-index="0" data-edit-entry-kind="text" data-pan-edit-entry="true"></g></svg>
       </div>
     </div>`,
    async (document) => {
      const { resolveAnnotationAt } = await import('../src/utils/annotationHitTest.js');
      const pageDiv = document.getElementById('viewer_pageDiv_0');
      const wrapper = document.querySelector('[data-diag-svg-wrapper="1"]');
      const carrier = document.querySelector('[data-annotation-index]');
      const box = { left: 0, top: 0, right: 200, bottom: 200 };
      stubRect(pageDiv, box);
      stubRect(wrapper, box);
      // The annotation sits far from the cursor.
      stubRect(carrier, { left: 150, top: 150, right: 190, bottom: 190 });
      document.elementsFromPoint = () => [pageDiv];
      const result = resolveAnnotationAt({
        clientX: 10,
        clientY: 10,
        composedPath: () => [],
      });
      assert.equal(result.kind, 'page');
      assert.equal(result.editEntryKind, null);
    },
  );
});
