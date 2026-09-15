import { useEffect, useMemo, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { shouldApplyPersistedFormValue } from './pdfjsFormLocalValueGuard.js';
import { fitMultilineFontSize, getPdfjsFormTextSizing } from './pdfjsFormTextSizing.js';
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
         its own stylesheet (which defines it) is never imported here. With it
         undefined the calc() was invalid and every field fell back to the
         fixed-px 'font: inherit' below, so boxes grew with zoom while the
         text inside stayed frozen. Deriving it from the --scale-factor this
         layer already maintains makes field text scale with the page. */
      --total-scale-factor: var(--scale-factor, 1);
    }
    .pdfjsFormLayer section { position: absolute; pointer-events: auto; box-sizing: border-box; }
    .pdfjsFormLayer[data-interactive="false"] section { pointer-events: none; }
    .pdfjsFormLayer .textWidgetAnnotation input, .pdfjsFormLayer .textWidgetAnnotation textarea,
    .pdfjsFormLayer .choiceWidgetAnnotation select, .pdfjsFormLayer .buttonWidgetAnnotation input {
      width: 100%; height: 100%; box-sizing: border-box; margin: 0; font: inherit;
      /* UX 2026-09-15 (owner: "when I zoom out, the content within checkboxes
         and text input fields does not stay aligned within the checkboxes or
         text input fields"): a form control is an INLINE-BLOCK replaced box by
         default, so it sits on its section's text baseline. The section
         inherits the app's 16px font, and that strut is a fixed CSS px no
         matter what the zoom is — so as the widget box shrinks below the strut,
         the control gets pushed further and further down inside its own box.
         Measured in prog-10/acrobat-authored-annotations.pdf at 57% zoom: the
         text field's control sat 7.1px low inside an 11.3px box (63% of the box
         height) and the checkbox's sat 3.7px low; at 139% and above both were
         flush, which is why it only ever showed up on zoom-OUT. Making the
         control a block box takes it out of the inline formatting context
         entirely: it fills its section's content box at every zoom. */
      display: block;
      /* Gutter + border ride the same scale as the page so the field chrome
         thickens/thins with zoom like every other annotation stroke. */
      padding: 0 calc(var(--total-scale-factor, 1) * 2px);
      background: rgba(60,130,255,0.06);
      border: calc(var(--total-scale-factor, 1) * 1px) solid rgba(60,130,255,0.55);
      color: #111;
    }
    .pdfjsFormLayer .buttonWidgetAnnotation.checkBox input {
      appearance: none; -webkit-appearance: none;
      background-color: var(--pdf-widget-background, #fff) !important;
      background-image: none !important;
      border-color: var(--pdf-widget-border, #000) !important;
      border-style: solid !important;
      /* UX 2026-09-15 (checkbox chrome scaled at a different rate than every
         other mark): --pdf-widget-border-width carries the widget's /MK border
         in PAGE UNITS (a bare number), multiplied here so the box outline
         thickens with zoom like every annotation stroke. It used to carry a
         fixed "Npx", and because this declaration is !important it also beat
         the per-zoom input.style.borderWidth write in syncScaleFactor - so
         the border sat at a constant 1-2 CSS px from fit-page to 400%. With
         box-sizing:border-box that also squeezed the padding box the tick mark
         is sized against (background-size:82%), so the glyph grew ~20% faster
         than its own box across the zoom range and drifted off centre. */
      border-width: calc(var(--pdf-widget-border-width, 1) * var(--total-scale-factor, 1) * 1px) !important;
      border-radius: 0;
    }
    .pdfjsFormLayer .buttonWidgetAnnotation.checkBox input:checked {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M3 8.3 6.3 12 13 4' fill='none' stroke='%23000' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") !important;
      background-position: center;
      background-repeat: no-repeat;
      background-size: 82% 82%;
    }
    .pdfjsFormLayer .buttonWidgetAnnotation.radioButton input { appearance: auto; -webkit-appearance: auto; background: #fff; }
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

// Re-fit every auto-fitting multiline widget so its value stays inside its own
// box at the CURRENT zoom.
//
// ZOOM CONTRACT (2026-09-15): the applied size is always a page-unit number
// multiplied by --total-scale-factor, so the text rides zoom exactly like the
// box around it. What could not be made zoom-invariant is the WRAP: the browser
// re-lays-out the value at every scale, and glyph advances at 17px and at 58px
// are not exact multiples of one another, so a line that ends flush with the
// box at one zoom spills to a second line at another. prog-07-form-fields.pdf
// is the witness — "Second line of the field value." fits on one line at 100%,
// 140% and 175%, and wraps at fit-page, 219%, 274% and 342%, pushing "Third
// line." out of sight. The old code ran the shrink loop ONCE inside a
// requestAnimationFrame at mount, so whichever zoom the field happened to mount
// at decided the answer forever and every other zoom clipped. Re-deriving the
// fit from the /DA size on each scale change is stateless (the same zoom always
// gives the same size, never a function of which zooms were visited) and keeps
// the value fully visible at every one of them.
function refitMultilineWidgets(targets) {
  if (!Array.isArray(targets) || targets.length === 0) return;
  for (const target of targets) {
    const el = target?.el;
    if (!el || !el.isConnected) continue;
    const fitted = fitMultilineFontSize({
      startFontSize: target.startFontSize,
      measure: (fontSize) => {
        el.style.fontSize = `calc(${fontSize}px * var(--total-scale-factor))`;
        return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
      },
    });
    el.style.fontSize = `calc(${fitted}px * var(--total-scale-factor))`;
    el.dataset.pdfWidgetFittedFontSize = String(fitted);
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

        // Capture pdf.js's widget-container border BEFORE anything rescales it.
        // It arrives as a fixed `${data.borderStyle.width}px` inline style in
        // CSS px; stash the number so syncScaleFactor can re-express it in page
        // units on every zoom (see the comment there).
        div.querySelectorAll('section[data-annotation-id]').forEach((section) => {
          const declared = parseFloat(section.style.borderWidth);
          if (Number.isFinite(declared) && declared > 0) {
            section.dataset.pdfWidgetContainerBorder = String(declared);
          }
        });

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
            el.style.fontSize = `calc(${startFontSize}px * var(--total-scale-factor))`;
            // UX: a multi-line value must be fully visible in its box. The /DA
            // size (or the auto-size from the line count) is the starting
            // point, but a long line can wrap at that size and push the last
            // line out of view (E2E: "Third line" clipped while the file's own
            // stored picture fit). Shrink until the wrapped text fits — that is
            // what the stored appearance already shows in other viewers.
            // The fit is re-derived on every zoom by refitMultilineWidgets (see
            // the zoom contract there); this list is what it walks.
            multilineFitTargets.push({ el, startFontSize });
          }
          if (meta.visualStyle && el.type === 'checkbox') {
            el.style.setProperty('--pdf-widget-background', meta.visualStyle.backgroundColor);
            el.style.setProperty('--pdf-widget-border', meta.visualStyle.borderColor);
            // PAGE UNITS, unitless: the stylesheet multiplies by
            // --total-scale-factor so the tick box outline rides zoom.
            el.style.setProperty('--pdf-widget-border-width', String(meta.visualStyle.borderWidth));
            // Kept for the DOM-level E2E/diagnostic probes that read the
            // declared width without parsing a calc().
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
        const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate });
        const pageWidthPoints = baseViewport.width;
        const host = div.parentElement;
        let refitHandle = 0;
        const syncScaleFactor = () => {
          const w = host ? host.offsetWidth : 0;
          if (w > 0 && pageWidthPoints > 0) {
            const measuredScale = w / pageWidthPoints;
            div.style.setProperty('--scale-factor', String(measuredScale));
            // The control's own border rides --total-scale-factor in CSS. The
            // WIDGET CONTAINER's border does not: pdf.js writes it as a fixed
            // `${data.borderStyle.width}px` inline style on the <section>
            // (annotation_layer #createContainer) and never revisits it, so a
            // PDF-declared widget outline — the red checkbox, the green notes
            // box — stayed a 1-2 CSS px hairline at every zoom while the box
            // around it grew. Because the section is border-box, that fixed
            // border also ate a shrinking share of the control inside it, which
            // walked the control's left edge ~0.2% of the page width across the
            // zoom range. Re-express it in page units on every resize.
            div.querySelectorAll('section[data-pdf-widget-container-border]').forEach((section) => {
              const sourceWidth = Number(section.dataset.pdfWidgetContainerBorder);
              if (Number.isFinite(sourceWidth) && sourceWidth > 0) {
                section.style.borderWidth = `${sourceWidth * measuredScale}px`;
              }
            });
            // The box just changed size; the value inside it has to be re-fitted
            // to the new one. Deferred a frame so the border/padding writes above
            // are in layout before anything is measured.
            if (multilineFitTargets.length > 0) {
              if (refitHandle) cancelAnimationFrame(refitHandle);
              refitHandle = requestAnimationFrame(() => {
                refitHandle = 0;
                refitMultilineWidgets(multilineFitTargets);
              });
            }
          }
        };
        detachers.push(() => { if (refitHandle) cancelAnimationFrame(refitHandle); refitHandle = 0; });
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
      style={{ position: 'absolute', inset: 0, zIndex: 12 }}
    />
  );
}
