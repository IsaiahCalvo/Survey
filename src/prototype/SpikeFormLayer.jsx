// ============================================================================
// FEATURE SPIKE — THROWAWAY. Form-field (Widget) overlay for one page.
// ============================================================================
// Turns on pdf.js's own AnnotationLayer for the page's form WIDGETS only (text
// fields, checkboxes, radios, dropdowns) — pdf.js renders them as real, interactive
// HTML inputs reading each widget's appearance + current value/state. We're only
// DETECTING + showing existing fields (not authoring). Markup annotations are still
// drawn by our own overlay, so we filter to Widget here to avoid double-rendering.
// ============================================================================
import { useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// AnnotationLayer wants a linkService; widgets barely use it, so a no-op stub is fine.
const LINK_SERVICE_STUB = {
  externalLinkTarget: null, externalLinkRel: null, externalLinkEnabled: false,
  getDestinationHash: () => '#', getAnchorUrl: () => '#', addLinkAttributes: () => {},
  goToDestination: () => {}, goToPage: () => {}, navigateTo: () => {},
  isPageVisible: () => true, isPageCached: () => true,
  executeNamedAction: () => {}, executeSetOCGState: () => {},
};

export default function SpikeFormLayer({ pdf, pageIndex, scale, rotation }) {
  const ref = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const div = ref.current;
      if (!div || !pdf) return;
      const page = await pdf.getPage(pageIndex + 1);
      if (cancelled) return;
      const all = await page.getAnnotations({ intent: 'display' });
      if (cancelled || !ref.current) return;
      const widgets = all.filter((a) => a.subtype === 'Widget');
      div.innerHTML = '';
      if (!widgets.length) return;
      const viewport = page.getViewport({ scale, rotation: page.rotate + rotation });
      div.style.setProperty('--scale-factor', String(scale));
      try {
        const layer = new pdfjsLib.AnnotationLayer({ div, page, viewport });
        await layer.render({
          annotations: widgets,
          linkService: LINK_SERVICE_STUB,
          downloadManager: null,
          renderForms: true,                 // → real <input>/<checkbox> elements
          annotationStorage: pdf.annotationStorage,
          imageResourcesPath: '',
          enableScripting: false,
          hasJSActions: false,
        });
      } catch { /* ignore — unsupported field, etc. */ }
    })();
    return () => { cancelled = true; };
  }, [pdf, pageIndex, scale, rotation]);

  return <div ref={ref} className="spikeFormLayer annotationLayer" style={{ position: 'absolute', inset: 0 }} />;
}
