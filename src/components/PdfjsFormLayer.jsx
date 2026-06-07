import { useEffect, useMemo, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

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
    .pdfjsFormLayer { pointer-events: none; }
    .pdfjsFormLayer section { position: absolute; pointer-events: auto; box-sizing: border-box; }
    .pdfjsFormLayer[data-interactive="false"] section { pointer-events: none; }
    .pdfjsFormLayer .textWidgetAnnotation input, .pdfjsFormLayer .textWidgetAnnotation textarea,
    .pdfjsFormLayer .choiceWidgetAnnotation select, .pdfjsFormLayer .buttonWidgetAnnotation input {
      width: 100%; height: 100%; box-sizing: border-box; margin: 0; font: inherit; padding: 0 2px;
      background: rgba(60,130,255,0.06); border: 1px solid rgba(60,130,255,0.55); color: #111;
    }
    .pdfjsFormLayer .buttonWidgetAnnotation.checkBox input,
    .pdfjsFormLayer .buttonWidgetAnnotation.radioButton input { appearance: auto; -webkit-appearance: auto; background: #fff; }
  `;
  document.head.appendChild(style);
}

// Reflect persisted form values onto the freshly built (or late-updated) inputs.
// Covers checkbox/radio booleans + any field the annotationStorage seed didn't
// drive, and never touches the element the user is actively editing.
function applyPersistedToInputs(div, seed) {
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

        // Wire interaction events for persistence. Values themselves live in
        // pdf.annotationStorage (pdf.js mirrors edits there automatically); these
        // listeners drive emit timing + focus state. The stable field key is the
        // widget id pdf.js stamps on each rendered section. We enrich the payload
        // with field name/type + PDF-space rect so the parent can build the
        // persisted carrier object and its bounds.
        const inputs = div.querySelectorAll('input, textarea, select');
        inputs.forEach((el) => {
          const section = el.closest('section');
          const fieldId = section?.getAttribute('data-annotation-id') || el.id || null;
          const meta = widgetMetaById.get(fieldId) || {};
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
          const onChange = () => cbRef.current.onFieldChange?.(emit(readValue()));
          const onFocus = () => cbRef.current.onFieldFocus?.({ fieldId, element: el });
          const onBlur = () => cbRef.current.onFieldBlur?.(emit(readValue()));
          el.addEventListener('input', onChange);
          el.addEventListener('change', onChange);
          el.addEventListener('focus', onFocus);
          el.addEventListener('blur', onBlur);
          detachers.push(() => {
            el.removeEventListener('input', onChange);
            el.removeEventListener('change', onChange);
            el.removeEventListener('focus', onFocus);
            el.removeEventListener('blur', onBlur);
          });
        });

        // Post-render: paint persisted values onto the live inputs (covers
        // checkbox/radio + any field the storage seed didn't drive). Reload has
        // nothing focused, so saved values show immediately.
        applyPersistedToInputs(div, seedNow);

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
        const syncScaleFactor = () => {
          const w = host ? host.offsetWidth : 0;
          if (w > 0 && pageWidthPoints > 0) {
            div.style.setProperty('--scale-factor', String(w / pageWidthPoints));
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
    applyPersistedToInputs(div, seed);
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
