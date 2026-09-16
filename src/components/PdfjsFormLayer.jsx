import { useEffect, useMemo, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { shouldApplyPersistedFormValue } from './pdfjsFormLocalValueGuard.js';
import { fitMultilineFontSize, getPdfjsFormTextSizing, multilineFitSignature } from './pdfjsFormTextSizing.js';
import { planWidgetChrome } from './pdfjsFormWidgetChrome.js';
import { getPdfWidgetVisualStyle } from '../utils/pdfAnnotationImporter.js';

/**
 * PdfjsFormLayer — interactive form-field (Widget) overlay for one page under
 * the owned pdf.js engine (Phase 37 cutover). Promoted from the prototype
 * SpikeFormLayer.
 *
 * Turns on pdf.js's own AnnotationLayer for the page's form WIDGETS only (text
 * fields, checkboxes, radio buttons, dropdowns), rendered as real interactive
 * HTML inputs that read each widget's appearance + current value. /ReadOnly
 * widgets are rendered disabled by pdf.js automatically. Markup annotations are
 * deliberately excluded (the app draws those itself), so we filter to Widget to
 * avoid double-rendering.
 *
 * Values are bound to the document's shared annotationStorage. The parent wires
 * onFieldChange/Focus/Blur to capture edits for persistence, and feeds saved
 * values back through `persistedValues` so reloaded widgets show what the user
 * last typed/ticked (see PDFViewer form-field persistence, Stage 4.3).
 *
 * Scaling/rotation match PdfjsViewerContainer: rendered at the committed `scale`
 * with the intrinsic /Rotate baked by pdf.js (user-rotation 0). The widgets ride
 * the host's live-zoom CSS transform during a gesture and re-render crisp on the
 * committed scale, exactly like the page canvas.
 */

/* STACKING CONTRACT (2026-09-15, corrected) — THE WIDGET LAYER PAINTS UNDER THE
   ANNOTATION OVERLAY, IN EVERY TOOL. PAINT ORDER AND HIT TEST ARE SEPARATE
   QUESTIONS AND ARE ANSWERED SEPARATELY.

   Intended UX (owner; reference behaviour Drawboard PDF):
     - A form field is fillable without hunting for a mode: one click toggles a
       checkbox or focuses a text field in Pan AND in every Select-family mode,
       with no tool change and no selection chrome.
     - The user's own markup is ALWAYS on top. A pen stroke, a text box or a
       shape drawn across a field stays fully visible and stays selectable —
       markup is what the user made, a widget is document content underneath it.

   Those two do not fight, because paint order is z-index and the hit test is
   pointer routing. This layer therefore sits at 12, BELOW the per-page SVG
   annotation overlay wrapper (zIndex 100 in PDFViewer.jsx, same stacking
   context), and the overlay hands a click back down instead:
   SVGAnnotationLayer's root pointerdown remembers a press that landed on blank
   SVG space over a live widget (utils/formWidgetPointerTargets.js), and on
   pointerup, if the gesture never moved, it forwards focus/toggle to the
   control. A gesture that DID move is a marquee or lasso and is left alone, so
   a rubber band started inside a field's box still selects.

   DO NOT "fix" a swallowed widget click by raising this number again. Briefly
   trying 101 (above the overlay) made every annotation drawn over a field
   invisible and unclickable and turned a marquee started inside a field into
   native text selection — guarded now by tests/formLayerAnnotationStacking.test.mjs.

   The number is fixed, never tool-dependent: a widget that swapped above and
   below markup as the armed tool changed would read as a rendering bug. */
const FORM_LAYER_Z_INDEX = 12;

const LINK_SERVICE_STUB = {
  externalLinkTarget: null, externalLinkRel: null, externalLinkEnabled: false,
  getDestinationHash: () => '#', getAnchorUrl: () => '#', addLinkAttributes: () => {},
  goToDestination: () => {}, goToPage: () => {}, navigateTo: () => {},
  isPageVisible: () => true, isPageCached: () => true,
  executeNamedAction: () => {}, executeSetOCGState: () => {},
};

let cssInjected = false;
function ensureFormLayerCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-pdfjs-form-layer-css', '');
  style.textContent = `
    .pdfjsFormLayer {
      pointer-events: none;
      /* UX 2026-07-14 (zoom-scaling unification): pdf.js sizes widget text as
         calc(Xpx * var(--total-scale-factor)) but only consumes the variable —
         its own stylesheet (which defines it) is never imported here. Defining
         it from the --scale-factor this layer maintains is what stops those
         calc()s being invalid. Every CONTROL then pins it back to 1 (see the
         zoom contract below), so pdf.js's own sizes land in page units. */
      --total-scale-factor: var(--scale-factor, 1);
    }
    .pdfjsFormLayer section { position: absolute; pointer-events: auto; box-sizing: border-box; }
    .pdfjsFormLayer[data-interactive="false"] section { pointer-events: none; }

    /* ZOOM CONTRACT (2026-09-15, round 2) — THE CONTROL IS LAID OUT IN PAGE
       UNITS AND MAPPED ONTO THE PAGE BY ONE UNIFORM TRANSFORM.

       Round 1 multiplied every length by --total-scale-factor, which is the
       right number carried by the wrong mechanism: a used CSS length is
       resolved and snapped by the layout engine at the CURRENT zoom, so
       border widths quantised to whole device pixels (a 1-page-unit outline
       painted 0.5 CSS px from 48% through 94%, a 1.9x spread in painted width
       per page unit across the ladder) and the browser re-wrapped every
       multiline value at every scale (settled sizes drifting 16.5 vs 17, and
       up to 1.5 s of visible overflow after a step while a refit landed).

       Laying the control out at its PAGE box and scaling it with
       transform: scale(--scale-factor) moves the zoom AFTER layout, which is
       exactly what the SVG viewBox does for every other annotation kind: the
       browser wraps, measures and snaps once, in page units, and the zoom only
       rasterises the result. --total-scale-factor is pinned to 1 inside the
       control so pdf.js's own calc(Npx * var(--total-scale-factor)) writes
       (font-size, --comb-width) land in page units too, instead of being
       scaled twice. Nothing in here may reintroduce a zoom-dependent length. */
    .pdfjsFormLayer .textWidgetAnnotation input, .pdfjsFormLayer .textWidgetAnnotation textarea,
    .pdfjsFormLayer .choiceWidgetAnnotation select, .pdfjsFormLayer .buttonWidgetAnnotation input {
      --total-scale-factor: 1;
      position: absolute; left: 0; top: 0;
      width: calc(var(--pdf-widget-page-w, 0) * 1px);
      height: calc(var(--pdf-widget-page-h, 0) * 1px);
      transform: scale(var(--scale-factor, 1));
      transform-origin: 0 0;
      box-sizing: border-box; margin: 0; font: inherit;
      /* UX 2026-09-15 (owner: "when I zoom out, the content within checkboxes
         and text input fields does not stay aligned within the checkboxes or
         text input fields"): a form control is an INLINE-BLOCK replaced box by
         default, so it sits on its section's text baseline, and that strut is a
         fixed CSS px whatever the zoom is — so as the widget box shrank below
         it the control was pushed further and further down inside its own box
         (measured at 57%: the text field's control sat 7.1px low in an 11.3px
         box). Out-of-flow + block removes the inline formatting context
         entirely. */
      display: block;
      /* Page units: the gutter is the widget's own outline inset plus the
         2-unit text inset pdf.js itself assumes (AnnotationLayer BORDER_SIZE). */
      padding: calc(var(--pdf-widget-inset, 0) * 1px) calc((var(--pdf-widget-inset, 0) + 2) * 1px);
      background: rgba(60,130,255,0.06);
      /* The outline is SVG geometry in pdfWidgetChrome below. A CSS border here
         is the defect: Chromium floors it to whole device pixels. */
      border: 0;
      color: #111;
    }
    .pdfjsFormLayer .buttonWidgetAnnotation.checkBox input {
      appearance: none; -webkit-appearance: none;
      background-color: var(--pdf-widget-background, #fff) !important;
      /* The tick is SVG geometry too — a background image was sized as 82% of a
         padding box that the quantised borders were eating into, so the glyph
         swung 13–31% relative to the page across the ladder. */
      background-image: none !important;
      border: 0 !important;
      border-radius: 0;
      padding: 0;
    }
    .pdfjsFormLayer .buttonWidgetAnnotation.radioButton input { appearance: auto; -webkit-appearance: auto; background: #fff; }

    /* One page-unit SVG per widget: the viewBox IS the widget's page box, so
       every stroke inside it holds its page ratio at any zoom and any device
       pixel ratio, exactly like SVGAnnotationLayer. */
    .pdfjsFormLayer .pdfWidgetChrome {
      position: absolute; left: 0; top: 0; width: 100%; height: 100%;
      pointer-events: none; overflow: visible;
    }
    .pdfjsFormLayer .pdfWidgetTick { display: none; }
    .pdfjsFormLayer input:checked ~ .pdfWidgetChrome .pdfWidgetTick { display: block; }
  `;
  document.head.appendChild(style);
}

// Reflect persisted form values onto the freshly built (or late-updated) inputs.
// Covers checkbox/radio booleans + any field the annotationStorage seed didn't
// drive, and never touches the element the user is actively editing.
function applyPersistedToInputs(div, seed, localDirtyValues) {
  if (!div || !Array.isArray(seed) || seed.length === 0) return;
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const elByFieldId = new Map();
  div.querySelectorAll('section[data-annotation-id]').forEach((section) => {
    const id = section.getAttribute('data-annotation-id');
    const el = section.querySelector('input, textarea, select');
    if (id && el) elByFieldId.set(id, el);
  });
  for (const pv of seed) {
    if (!pv || pv.fieldId == null) continue;
    if (!shouldApplyPersistedFormValue(localDirtyValues, pv.fieldId, pv.value)) continue;
    const el = elByFieldId.get(String(pv.fieldId));
    if (!el || el === active) continue;
    if (el.type === 'checkbox' || el.type === 'radio') {
      const want = !!pv.value;
      if (el.checked !== want) el.checked = want;
    } else {
      const want = pv.value == null ? '' : String(pv.value);
      if (el.value !== want) el.value = want;
    }
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
// The field chrome the app draws itself, in page units, for every widget the
// PDF did not give its own /MK border (text fields, dropdowns).
const FIELD_OUTLINE_PAGE_UNITS = 1;
const FIELD_OUTLINE_COLOR = 'rgba(60,130,255,0.55)';
const TICK_COLOR = '#000';

const percentOf = (declared, total) => {
  const raw = String(declared || '').trim();
  if (!raw.endsWith('%')) return NaN;
  const pct = parseFloat(raw);
  if (!Number.isFinite(pct) || !Number.isFinite(total)) return NaN;
  return (pct / 100) * total;
};

// Give every widget its page box and its page-unit chrome.
//
// WHY THE PAGE BOX COMES FROM pdf.js's OWN PERCENTAGE: pdf.js positions and
// sizes each <section> as a percentage of the layer, and the layer is the page
// host. `pct% x pageWidthPoints` is therefore the widget's exact page box, and
// `box x --scale-factor` is exactly the section's CSS size at every zoom — with
// no measurement, so no rounding creeps in as the reader zooms.
//
// WHY THE OUTLINES MOVE TO SVG: pdf.js writes the PDF's /BS width as a fixed
// `${data.borderStyle.width}px` inline style on the <section> and never
// revisits it, and round 1's fix (rewriting it as `width * scale` px on every
// resize) still went through a CSS border, which Chromium floors to whole
// device pixels — 0.5 CSS px for everything from 48% to 94% at dpr 2. As SVG
// geometry inside a page-unit viewBox the same outline holds its page ratio at
// every zoom and every dpr. Zeroing the CSS border also removes the border-box
// inset that used to walk the control's left edge 0.2% of the page width.
function installWidgetChrome(div, pageWidthPoints, pageHeightPoints, widgetMetaById) {
  div.querySelectorAll('section[data-annotation-id]').forEach((section) => {
    const meta = widgetMetaById.get(section.getAttribute('data-annotation-id')) || {};
    // The widget's own PDF rect is the backstop for the one case pdf.js leaves
    // the percentages unset (a widget with no /Rect). Without a page box the
    // control's page-unit width would resolve to 0 and the field would vanish,
    // so never leave it unset.
    const rectW = Array.isArray(meta.rect) ? Math.abs(Number(meta.rect[2]) - Number(meta.rect[0])) : NaN;
    const rectH = Array.isArray(meta.rect) ? Math.abs(Number(meta.rect[3]) - Number(meta.rect[1])) : NaN;
    const declaredW = percentOf(section.style.width, pageWidthPoints);
    const declaredH = percentOf(section.style.height, pageHeightPoints);
    const pageWidth = declaredW > 0 ? declaredW : rectW;
    const pageHeight = declaredH > 0 ? declaredH : rectH;
    if (!(pageWidth > 0) || !(pageHeight > 0)) return;

    const control = section.querySelector('input, textarea, select');
    const isRadio = control?.type === 'radio';
    const isCheckbox = control?.type === 'checkbox';

    const declaredContainer = parseFloat(section.style.borderWidth);
    const containerBorder = Number.isFinite(declaredContainer) && declaredContainer > 0 ? declaredContainer : 0;
    const containerColor = section.style.borderColor || '#000';
    // pdf.js expresses the PDF's /BS /S as CSS: 'dashed' for /D, and for /U
    // (underline) it sets ONLY borderBottomStyle, so only the bottom edge
    // painted. Carry both through, or an underlined widget would gain three
    // edges it never had.
    const containerDashed = section.style.borderStyle === 'dashed';
    const containerUnderline = !section.style.borderStyle && section.style.borderBottomStyle === 'solid';
    if (containerBorder > 0) section.style.borderWidth = '0px';

    let controlBorder = 0;
    let controlColor = FIELD_OUTLINE_COLOR;
    if (isCheckbox && meta.visualStyle) {
      controlBorder = Math.max(0, Number(meta.visualStyle.borderWidth) || 0);
      controlColor = meta.visualStyle.borderColor || '#000';
    } else if (control && !isRadio) {
      controlBorder = FIELD_OUTLINE_PAGE_UNITS;
    }

    const plan = planWidgetChrome({
      pageWidth, pageHeight, containerBorder, controlBorder, tick: isCheckbox,
    });
    if (!plan) return;

    section.style.setProperty('--pdf-widget-page-w', String(pageWidth));
    section.style.setProperty('--pdf-widget-page-h', String(pageHeight));
    section.style.setProperty('--pdf-widget-inset', String(plan.inset));
    // Read by the zoom-lock probes so a live measurement can normalise a
    // painted extent against the widget's page box without re-deriving it.
    section.dataset.pdfWidgetPageWidth = String(pageWidth);
    section.dataset.pdfWidgetPageHeight = String(pageHeight);

    if (plan.outlines.length === 0 && !plan.tick) return;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'pdfWidgetChrome');
    svg.setAttribute('viewBox', plan.viewBox);
    // The section's aspect ratio is this viewBox's by construction, so 'none'
    // only removes a sub-pixel letterbox; it never stretches the strokes.
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    for (const outline of plan.outlines) {
      const isContainer = outline.kind === 'container';
      const underline = isContainer && containerUnderline;
      const rect = document.createElementNS(SVG_NS, underline ? 'line' : 'rect');
      if (underline) {
        const y = pageHeight - outline.strokeWidth / 2;
        rect.setAttribute('x1', '0'); rect.setAttribute('x2', String(pageWidth));
        rect.setAttribute('y1', String(y)); rect.setAttribute('y2', String(y));
      } else {
        rect.setAttribute('x', String(outline.x));
        rect.setAttribute('y', String(outline.y));
        rect.setAttribute('width', String(outline.width));
        rect.setAttribute('height', String(outline.height));
      }
      if (isContainer && containerDashed) {
        rect.setAttribute('stroke-dasharray', `${3 * outline.strokeWidth} ${2 * outline.strokeWidth}`);
      }
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', isContainer ? containerColor : controlColor);
      rect.setAttribute('stroke-width', String(outline.strokeWidth));
      rect.setAttribute('data-pdf-widget-outline', outline.kind);
      svg.appendChild(rect);
    }
    if (plan.tick) {
      const tick = document.createElementNS(SVG_NS, 'polyline');
      tick.setAttribute('class', 'pdfWidgetTick');
      tick.setAttribute('points', plan.tick.pointsAttr);
      tick.setAttribute('fill', 'none');
      tick.setAttribute('stroke', TICK_COLOR);
      tick.setAttribute('stroke-width', String(plan.tick.strokeWidth));
      tick.setAttribute('stroke-linecap', 'round');
      tick.setAttribute('stroke-linejoin', 'round');
      tick.setAttribute('data-pdf-widget-tick', 'true');
      svg.appendChild(tick);
    }
    // Appended AFTER the control so `input:checked ~ .pdfWidgetChrome` can show
    // the tick with no JavaScript, and so the chrome paints over the control's
    // own background.
    section.appendChild(svg);
  });
}

// Fit every auto-fitting multiline widget's value inside its own box — ONCE,
// in page units.
//
// ZOOM CONTRACT (2026-09-15, round 2): this is not a per-zoom operation. The
// control is laid out at its page box and scaled by a transform, so
// scrollHeight/clientHeight (layout values, which transforms do not touch) are
// page units, the browser wraps the value exactly once, and the answer is the
// same number at 24% as at 447%. `multilineFitSignature` states what the answer
// may depend on — the page box, the starting size and the text — and a zoom
// changes none of them, so a zoom step does literally nothing here: no
// re-measure, no re-wrap, and no window in which the value overflows its box
// while a deferred refit lands. (v1 fitted once at mount at whatever zoom the
// field mounted at and clipped everywhere else; v2 refitted inside a
// requestAnimationFrame on every scale change, which left the value overflowing
// for up to 1.5 s after a step and let the browser re-wrap at each scale.)
function refitMultilineWidgets(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return;
  for (const target of targets) {
    const el = target?.el;
    if (!el || !el.isConnected) continue;
    const signature = multilineFitSignature({
      pageWidth: target.pageWidth,
      pageHeight: target.pageHeight,
      startFontSize: target.startFontSize,
      value: el.value,
    });
    if (signature === target.signature) continue;
    const fitted = fitMultilineFontSize({
      startFontSize: target.startFontSize,
      measure: (fontSize) => {
        el.style.fontSize = `${fontSize}px`;
        return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
      },
    });
    el.style.fontSize = `${fitted}px`;
    el.dataset.pdfWidgetFittedFontSize = String(fitted);
    target.signature = signature;
  }
}

export default function PdfjsFormLayer({
  pdf,
  pageNumber,
  scale = 1,
  interactive = true,
  persistedValues,
  onFieldChange,
  onFieldFocus,
  onFieldBlur,
}) {
  const ref = useRef(null);
  // Keep the latest callbacks reachable from DOM listeners without re-rendering the layer.
  const cbRef = useRef({ onFieldChange, onFieldFocus, onFieldBlur });
  cbRef.current = { onFieldChange, onFieldFocus, onFieldBlur };
  // Latest persisted values reachable from the render effect WITHOUT adding them
  // to its deps — so a value edit never rebuilds the layer DOM (which would
  // detach listeners and drop the caret). A separate sync effect handles values
  // that arrive after mount (reload hydration / a collaborator's edit).
  const persistedRef = useRef(persistedValues);
  persistedRef.current = persistedValues;
  // A blur-save from one field can re-render persistedValues while another
  // field's newer edit is still inside the 400ms save debounce. Keep that
  // newer DOM value authoritative until the parent echoes it back; otherwise
  // the stale cross-field snapshot visibly flips a checkbox/text value back.
  const localDirtyValuesRef = useRef(new Map());
  const persistedSignature = useMemo(
    () => (Array.isArray(persistedValues)
      ? persistedValues.map((v) => `${v?.fieldId}=${v?.value}`).join('|')
      : ''),
    [persistedValues],
  );
  // Latest committed scale, used only as the initial render hint (the authority
  // for sizing is the ResizeObserver in the render effect, which measures the
  // page host). pdf.js sizes this whole layer as
  // `round(var(--scale-factor) * pagePoints)` and positions every widget as a
  // percentage of it, so ZOOM IS HANDLED BY UPDATING THE CSS VARIABLE ALONE —
  // never by tearing down + rebuilding the inputs, which would drop focus,
  // flicker, and lose in-flight edits during a pinch.
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => { ensureFormLayerCss(); }, []);

  useEffect(() => {
    let cancelled = false;
    const div = ref.current;
    if (!div || !pdf || !pageNumber) return undefined;
    div.removeAttribute('data-persistence-ready');
    const detachers = [];

    (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled || !ref.current) return;
        const all = await page.getAnnotations({ intent: 'display' });
        if (cancelled || !ref.current) return;
        const widgets = all.filter((a) => a.subtype === 'Widget');
        div.innerHTML = '';
        if (!widgets.length) return;
        const widgetMetaById = new Map();
        for (const w of widgets) {
          widgetMetaById.set(w.id, {
            fieldName: w.fieldName ?? null,
            fieldType: w.fieldType ?? null,
            rect: Array.isArray(w.rect) ? w.rect : null,
            visualStyle: getPdfWidgetVisualStyle(w),
            textSizing: getPdfjsFormTextSizing(w),
          });
        }
        const viewport = page.getViewport({ scale: scaleRef.current, rotation: page.rotate });
        div.style.setProperty('--scale-factor', String(scaleRef.current));

        // Seed saved values into the shared annotationStorage BEFORE render so
        // reloaded text widgets paint their persisted value rather than blank.
        const seedNow = Array.isArray(persistedRef.current) ? persistedRef.current : [];
        for (const pv of seedNow) {
          if (pv && pv.fieldId != null) {
            try { pdf.annotationStorage.setValue(String(pv.fieldId), { value: pv.value }); } catch { /* ignore */ }
          }
        }

        const layer = new pdfjsLib.AnnotationLayer({ div, page, viewport });
        await layer.render({
          annotations: widgets,
          linkService: LINK_SERVICE_STUB,
          downloadManager: null,
          renderForms: true,
          annotationStorage: pdf.annotationStorage,
          imageResourcesPath: '',
          enableScripting: false,
          hasJSActions: false,
        });
        if (cancelled || !ref.current) return;

        // Page geometry for the whole layer. `baseViewport.width/height` are the
        // units pdf.js's own section percentages are relative to, so they are
        // what turns those percentages into each widget's page box AND what the
        // measured scale below is derived from — one number, no drift.
        const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate });
        const pageWidthPoints = baseViewport.width;
        const pageHeightPoints = baseViewport.height;

        // Page-unit box + page-unit SVG chrome for every widget. Runs BEFORE
        // anything measures a control, because it is what gives the control its
        // layout size.
        installWidgetChrome(div, pageWidthPoints, pageHeightPoints, widgetMetaById);

        // Wire interaction events for persistence. Values themselves live in
        // pdf.annotationStorage (pdf.js mirrors edits there automatically); these
        // listeners drive emit timing + focus state. The stable field key is the
        // widget id pdf.js stamps on each rendered section. We enrich the payload
        // with field name/type + PDF-space rect so the parent can build the
        // persisted carrier object and its bounds.
        const multilineFitTargets = [];
        const inputs = div.querySelectorAll('input, textarea, select');
        inputs.forEach((el) => {
          const section = el.closest('section');
          const fieldId = section?.getAttribute('data-annotation-id') || el.id || null;
          const meta = widgetMetaById.get(fieldId) || {};
          if (meta.textSizing && el.tagName === 'TEXTAREA') {
            const startFontSize = meta.textSizing.fontSize;
            // PAGE UNITS, no calc: the control is laid out at its page box and
            // scaled by one transform, so a bare px here IS a page unit and the
            // glyph size per page unit is the same number at every zoom.
            el.style.fontSize = `${startFontSize}px`;
            // UX: a multi-line value must be fully visible in its box. The /DA
            // size (or the auto-size from the line count) is the starting
            // point, but a long line can wrap at that size and push the last
            // line out of view (E2E: "Third line" clipped while the file's own
            // stored picture fit). Shrink until the wrapped text fits — that is
            // what the stored appearance already shows in other viewers.
            multilineFitTargets.push({
              el,
              startFontSize,
              pageWidth: Number(section?.dataset.pdfWidgetPageWidth) || 0,
              pageHeight: Number(section?.dataset.pdfWidgetPageHeight) || 0,
              signature: null,
            });
          }
          if (meta.visualStyle && el.type === 'checkbox') {
            el.style.setProperty('--pdf-widget-background', meta.visualStyle.backgroundColor);
            // The outline and the tick are SVG now (installWidgetChrome); this
            // stays for the DOM-level E2E/diagnostic probes that read the
            // declared page-unit width straight off the control.
            el.dataset.pdfWidgetBorderWidth = String(meta.visualStyle.borderWidth);
            el.checked = meta.visualStyle.checked;
          }
          const readValue = () => {
            if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
            return el.value;
          };
          const emit = (value) => ({
            fieldId,
            value,
            fieldName: meta.fieldName ?? null,
            fieldType: meta.fieldType ?? null,
            rect: meta.rect ?? null,
            element: el,
          });
          const recordLocalValue = () => {
            const value = readValue();
            if (fieldId != null) localDirtyValuesRef.current.set(String(fieldId), value);
            return value;
          };
          const onInput = () => {
            const value = recordLocalValue();
            cbRef.current.onFieldChange?.(emit(value));
          };
          const onChange = () => {
            // React can echo the input event's persisted snapshot before the
            // browser dispatches checkbox change. Reuse the value captured by
            // input so that intermediate render cannot flip the DOM back.
            const key = fieldId == null ? null : String(fieldId);
            const value = key != null && localDirtyValuesRef.current.has(key)
              ? localDirtyValuesRef.current.get(key)
              : recordLocalValue();
            if (el.type === 'checkbox' || el.type === 'radio') el.checked = !!value;
            cbRef.current.onFieldChange?.(emit(value));
          };
          const onFocus = () => cbRef.current.onFieldFocus?.({ fieldId, element: el });
          const onBlur = () => cbRef.current.onFieldBlur?.(emit(readValue()));
          el.addEventListener('input', onInput);
          el.addEventListener('change', onChange);
          el.addEventListener('focus', onFocus);
          el.addEventListener('blur', onBlur);
          detachers.push(() => {
            el.removeEventListener('input', onInput);
            el.removeEventListener('change', onChange);
            el.removeEventListener('focus', onFocus);
            el.removeEventListener('blur', onBlur);
          });
        });

        // Post-render: paint persisted values onto the live inputs (covers
        // checkbox/radio + any field the storage seed didn't drive). Reload has
        // nothing focused, so saved values show immediately.
        applyPersistedToInputs(div, seedNow, localDirtyValuesRef.current);
        div.setAttribute('data-persistence-ready', 'true');

        // Lock the field layer to the ACTUAL page geometry, not the React scale
        // prop. On wheel/pinch zoom the engine resizes the page host but does NOT
        // update that prop (the heavy zoom-change handler is gated off under
        // pdf.js), which left the fields at the old size and offset from the page
        // — the "stops working after zoom" symptom. pdf.js sizes this layer as
        // round(--scale-factor * pagePoints); the parent overlay host always
        // tracks the page, so derive --scale-factor from the host's measured
        // width and recompute on every resize (button, wheel, pinch, window).
        // Inputs are never rebuilt, so focus/caret/in-flight edits survive zoom.
        const host = div.parentElement;
        const syncScaleFactor = () => {
          const w = host ? host.offsetWidth : 0;
          if (w > 0 && pageWidthPoints > 0) {
            const measuredScale = w / pageWidthPoints;
            // ONE number carries the zoom for this whole layer: pdf.js's
            // percentage geometry rides it, and every control's transform reads
            // it. Nothing else in the layer may look at the scale.
            div.style.setProperty('--scale-factor', String(measuredScale));
            // SYNCHRONOUS, and a no-op unless a widget's PAGE box actually
            // changed. The fit is zoom-invariant (see refitMultilineWidgets), so
            // a zoom step must not leave the value overflowing for even one
            // frame — which is precisely what the requestAnimationFrame this
            // replaced did: measured up to 1.5 s of overflow after a step.
            refitMultilineWidgets(multilineFitTargets);
          }
        };
        syncScaleFactor();
        if (host && typeof ResizeObserver !== 'undefined') {
          const ro = new ResizeObserver(syncScaleFactor);
          ro.observe(host);
          detachers.push(() => { try { ro.disconnect(); } catch { /* noop */ } });
        }
      } catch { /* unsupported field, mid-unmount, etc. — never throw out of an overlay */ }
    })();

    return () => {
      cancelled = true;
      div.removeAttribute('data-persistence-ready');
      detachers.forEach((fn) => { try { fn(); } catch { /* noop */ } });
    };
    // NOTE: `scale` is deliberately NOT a dependency — zoom is ridden by the
    // ResizeObserver above (it only updates --scale-factor from the measured page
    // host). Rebuilding here on every zoom step is what made typing unreliable
    // after zooming, and the prop doesn't even update on wheel/pinch zoom.
  }, [pdf, pageNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // Late-hydration + collaborator sync: when persisted values change after the
  // layer has rendered, push them into annotationStorage AND the live inputs in
  // place — WITHOUT rebuilding the layer (which would drop the caret). The
  // focused element is skipped so active typing is never clobbered.
  useEffect(() => {
    const div = ref.current;
    if (!div || !pdf) return undefined;
    const seed = Array.isArray(persistedValues) ? persistedValues : [];
    if (seed.length === 0) return undefined;
    for (const pv of seed) {
      if (pv && pv.fieldId != null) {
        try { pdf.annotationStorage.setValue(String(pv.fieldId), { value: pv.value }); } catch { /* ignore */ }
      }
    }
    applyPersistedToInputs(div, seed, localDirtyValuesRef.current);
    return undefined;
    // persistedValues is read fresh whenever its signature changes.
  }, [pdf, pageNumber, persistedSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={ref}
      className="pdfjsFormLayer annotationLayer"
      data-pdfjs-form-layer={pageNumber}
      data-interactive={interactive ? 'true' : 'false'}
      style={{ position: 'absolute', inset: 0, zIndex: FORM_LAYER_Z_INDEX }}
    />
  );
}
