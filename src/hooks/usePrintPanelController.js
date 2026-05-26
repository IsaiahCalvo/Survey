import { useCallback, useEffect, useMemo, useRef } from 'react';

const PAPER_DIM_INCHES = {
  auto: null,
  letter: [8.5, 11],
  legal: [8.5, 14],
  tabloid: [11, 17],
  a4: [8.27, 11.69],
  a3: [11.69, 16.54],
  archD: [24, 36],
  archE: [36, 48],
};

export function usePrintPanelController({
  numPages,
  pageSizes,
  pdfDoc,
  pageTransformations,
  setPrintPanelOpen,
}) {
  // Pages data fed to the PrintPanel — derived from the Syncfusion-reported
  // pageSizes map. Falls back to Letter portrait if sizes aren't populated yet
  // so the panel still opens cleanly.
  const printPanelPages = useMemo(() => {
    const n = Number(numPages) || 0;
    if (n <= 0) return [];
    const list = [];
    for (let i = 1; i <= n; i++) {
      const ps = pageSizes?.[i];
      const w = (ps && Number.isFinite(ps.width) && ps.width > 0) ? ps.width / 72 : 8.5;
      const h = (ps && Number.isFinite(ps.height) && ps.height > 0) ? ps.height / 72 : 11;
      list.push({ index: i, width: +w.toFixed(2), height: +h.toFixed(2), isLandscape: w > h });
    }
    return list;
  }, [numPages, pageSizes]);

  // UX 2026-04-23: the Print Panel's preview and thumbnail strip render every
  // page on demand through PDF.js, NOT through Syncfusion's thumbnail cache.
  // Syncfusion only holds a rendered canvas for pages the user has scrolled
  // near, so reading from it left most preview slots blank or returning null.
  // PDF.js is already loaded for the main app, so we reuse the same pdfDoc and
  // cache each rasterized page by (pageNumber, targetWidth) for instant
  // re-use when the user flips through pages or opens Bigger Preview.
  const printPanelRenderCacheRef = useRef(new Map());
  const printPanelInflightRef = useRef(new Map());
  // UX 2026-04-24: cache of per-page content-based rotation detection
  // results. Acrobat-style "Auto" orientation rotates each page so the
  // drawing's text reads upright regardless of how the underlying sheet
  // is defined. We detect by reading the PDF's text items' transform
  // matrices, picking the dominant text angle, and recording the inverse
  // needed to set it right. One entry per page, recomputed only when a
  // new document loads.
  const printPanelContentRotRef = useRef(new Map());
  useEffect(() => {
    // New document → drop any cached renders + in-flight promises.
    printPanelRenderCacheRef.current = new Map();
    printPanelInflightRef.current = new Map();
    printPanelContentRotRef.current = new Map();
  }, [pdfDoc]);
  // Reset the Auto-rotation cache whenever the user rotates pages in the
  // main viewer so the panel's Auto mode follows their live view.
  useEffect(() => {
    printPanelContentRotRef.current = new Map();
  }, [pageTransformations]);

  // UX 2026-04-24: Auto orientation mirrors what the user is already
  // viewing. The main viewer tracks per-page rotation in
  // `pageTransformations` — whatever orientation the user is looking at
  // is the orientation they expect to print. We simply return that
  // rotation and let the print pipeline apply it. Diagnostic logs make
  // the decision traceable per page so we can see exactly what Auto is
  // doing for any given sheet.
  const getPageContentRotation = useCallback(async (pageNumber) => {
    if (!pdfDoc || typeof pdfDoc.getPage !== 'function') return 0;
    const cache = printPanelContentRotRef.current;
    if (cache.has(pageNumber)) return cache.get(pageNumber);
    try {
      const viewerRot = (pageTransformations?.[pageNumber]?.rotation) || 0;
      const page = await pdfDoc.getPage(pageNumber);
      const pdfRot = page?.rotate || 0;
      const view = page?.view || [0, 0, 612, 792];
      const pageW = Math.max(1, view[2] - view[0]);
      const pageH = Math.max(1, view[3] - view[1]);
      const rawAspect = pageW / pageH;
      const correction = (((viewerRot % 360) + 360) % 360);
      // Compute how the user sees the page right now (aspect after the
      // PDF's own /Rotate and their manual rotation have both applied).
      const totalApplied = ((pdfRot + viewerRot) % 360 + 360) % 360;
      const displayedLandscape = (totalApplied === 90 || totalApplied === 270)
        ? (rawAspect <= 1)
        : (rawAspect >= 1);
      console.log(
        `[PrintPanel→App] AUTO detect page=${pageNumber}`,
        `pdfRotate=${pdfRot}°`,
        `viewerRotate=${viewerRot}°`,
        `rawBox=${pageW.toFixed(0)}×${pageH.toFixed(0)}(${rawAspect.toFixed(2)})`,
        `displayedAs=${displayedLandscape ? 'landscape' : 'portrait'}`,
        `→ correction=${correction}°`
      );
      cache.set(pageNumber, correction);
      return correction;
    } catch (err) {
      console.warn(`[PrintPanel→App] auto detect failed p=${pageNumber}:`, err?.message || err);
      return 0;
    }
  }, [pdfDoc, pageTransformations]);

  // UX 2026-04-24: the Print Panel renderer now bakes the user's per-page
  // transforms directly into the returned canvas — rotation, mirror H/V,
  // and "markups off" (annotationMode=disable) all apply at render time so
  // both the preview and the print pipeline see a pixel-accurate page. BW
  // stays a client-side CSS filter to keep the cache small. Paper size +
  // fit mode are applied by the print pipeline when composing the final
  // sheet; the base render is always at the page's own aspect so zooming
  // stays crisp.
  const printPanelGetThumbnail = useCallback(async (pageNumber, opts = {}) => {
    const targetWidth = Math.max(40, Math.round(opts?.targetWidth || 140));
    const rotation = ((opts?.rotation || 0) % 360 + 360) % 360;
    const mirrorH = !!opts?.mirrorH;
    const mirrorV = !!opts?.mirrorV;
    const withAnnotations = opts?.withAnnotations !== false; // default true
    const key = `${pageNumber}:${targetWidth}:r${rotation}:mh${mirrorH ? 1 : 0}:mv${mirrorV ? 1 : 0}:a${withAnnotations ? 1 : 0}`;
    const cache = printPanelRenderCacheRef.current;
    const inflight = printPanelInflightRef.current;
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = inflight.get(key);
    if (pending) return pending;
    if (!pdfDoc || typeof pdfDoc.getPage !== 'function') {
      console.log(`[PrintPanel→App] pdfDoc not ready yet for page ${pageNumber}`);
      return null;
    }
    const job = (async () => {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        // UX 2026-04-24: the page's own /Rotate tag MUST be combined with
        // our user-requested rotation. Passing just `rotation` to pdfjs
        // overrides the intrinsic rotation, which made pages with
        // /Rotate 270 (landscape-displayed from a portrait media box)
        // render sideways. Total = intrinsic + user correction, mod 360.
        const intrinsicRot = page?.rotate || 0;
        const totalRotation = (((intrinsicRot + rotation) % 360) + 360) % 360;
        const baseViewport = page.getViewport({ scale: 1, rotation: totalRotation });
        const scale = targetWidth / baseViewport.width;
        const viewport = page.getViewport({ scale, rotation: totalRotation });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext('2d');
        // White backing so transparent PDF regions don't render as black.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const renderParams = {
          canvasContext: ctx,
          viewport,
          // Disable wipes out every annotation (sticky notes, free text,
          // surveyMarkers) so "Markups off" produces a clean page.
          annotationMode: withAnnotations ? 1 /* ENABLE */ : 0 /* DISABLE */,
        };
        await page.render(renderParams).promise;
        // UX 2026-04-24: mirror AFTER pdfjs finishes rendering. Applying
        // ctx.scale before render didn't stick because pdfjs resets the
        // canvas transform internally via setTransform. Draw the rendered
        // page back onto itself through a temp canvas flipped on the
        // chosen axis — this reliably mirrors the pixels.
        if (mirrorH || mirrorV) {
          const tmp = document.createElement('canvas');
          tmp.width = canvas.width;
          tmp.height = canvas.height;
          const tctx = tmp.getContext('2d');
          tctx.translate(mirrorH ? canvas.width : 0, mirrorV ? canvas.height : 0);
          tctx.scale(mirrorH ? -1 : 1, mirrorV ? -1 : 1);
          tctx.drawImage(canvas, 0, 0);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(tmp, 0, 0);
        }
        // UX 2026-04-24: JPEG at quality 0.85 is ~5-10× smaller than PNG
        // for raster page output and encodes far faster — enough to take
        // a 100-page job from minutes to seconds. Tiny renders (≤180px,
        // strip thumbnails) stay PNG for crispness on UI surfaces.
        const useJpeg = canvas.width > 180;
        const result = {
          src: useJpeg ? canvas.toDataURL('image/jpeg', 0.85) : canvas.toDataURL('image/png'),
          width: canvas.width,
          height: canvas.height,
        };
        cache.set(key, result);
        console.log(`[PrintPanel→App] rendered page=${pageNumber} @ ${canvas.width}×${canvas.height} (target ${targetWidth}px, rot=${rotation}, mirror=${mirrorH?'H':''}${mirrorV?'V':''}, annot=${withAnnotations})`);
        return result;
      } catch (err) {
        console.warn(`[PrintPanel→App] render failed page=${pageNumber}:`, err?.message || err);
        return null;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, job);
    return job;
  }, [pdfDoc]);

  // UX 2026-04-24: full custom print pipeline. Accepts a jobSpec with
  // per-page resolved settings (rotation, mirror, markups, BW, paper size,
  // fit mode, orientation) from the PrintPanel. Renders every included
  // page at print resolution via PDF.js with transforms baked in, then
  // composes an HTML print document where each page sits on its user-
  // chosen paper using @page CSS, and finally opens a hidden iframe and
  // triggers its print(). The OS print dialog appears so the user can
  // confirm the printer, copies, duplex, etc. Pages NOT in the top-row
  // selection are omitted entirely, honoring the scope rules.
  const handlePrintPanelPrint = useCallback(async (jobSpec) => {
    console.log('[PrintPanel] Print fired, composing', jobSpec.perPage?.length, 'page(s)');
    const pages = Array.isArray(jobSpec.perPage) ? jobSpec.perPage : [];
    if (!pages.length) {
      console.warn('[PrintPanel] no pages to print — aborting');
      setPrintPanelOpen(false);
      return;
    }
    try {
      // 1. Render each page with its per-page transforms baked in.
      //    Native-dialog mode targets 1200px wide (~140 DPI at Letter)
      //    so the OS print dialog appears in seconds, not minutes, on
      //    a 100-page PDF. Custom-panel mode (no useNativeDialog) keeps
      //    the higher 2000px target. Renders run in parallel with a
      //    concurrency cap so PDF.js doesn't get hammered.
      // Native-dialog mode: smaller width because the OS dialog scales
      // the preview anyway, and JPEG output keeps the data URL light.
      // Custom-panel mode keeps the higher target for crisp print pixels.
      const targetWidth = jobSpec.useNativeDialog === true ? 900 : 2000;
      const CONCURRENCY = 8;
      const renderResults = new Array(pages.length);
      let cursor = 0;
      const runWorker = async () => {
        while (true) {
          const slot = cursor++;
          if (slot >= pages.length) return;
          const p = pages[slot];
          const img = await printPanelGetThumbnail(p.pageNumber, {
            targetWidth,
            rotation: p.rotation,
            mirrorH: p.mirrorH,
            mirrorV: p.mirrorV,
            withAnnotations: p.withAnnotations,
          });
          if (img?.src) {
            renderResults[slot] = { spec: p, img };
          } else {
            console.warn(`[PrintPanel] print render missing for page ${p.pageNumber}`);
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, runWorker));
      const perPageRenders = renderResults.filter(Boolean);
      if (!perPageRenders.length) {
        console.warn('[PrintPanel] no page renders produced — aborting print');
        setPrintPanelOpen(false);
        return;
      }
      // 2. Compose the HTML print document. Each page is its own printed
      //    sheet with a per-page @page rule so mixed paper sizes work.
      const pageBlocks = perPageRenders.map(({ spec, img }, idx) => {
        // Resolve the target paper size in inches. Auto = use the page's
        // natural size (and its orientation follows the rotation).
        let paperW;
        let paperH;
        if (spec.paperSize === 'auto') {
          // Page's natural size, but swap if the baked rotation made it
          // landscape when the user's orientation override demands portrait
          // (or vice versa). Simplest accurate model: use image aspect.
          const ar = img.width / img.height;
          // Default to keeping natural size, but orient per aspect.
          paperW = ar >= 1 ? 11 : 8.5;
          paperH = ar >= 1 ? 8.5 : 11;
        } else if (spec.paperSize === 'match' && spec.matchPageDims) {
          // UX 2026-04-24: "Match another page" means the printed sheet's
          // shape IS the reference page's shape, exactly. Auto orientation
          // follows the reference page (not the currently rendered page's
          // aspect). Only Portrait/Landscape explicit overrides can swap.
          const mW = spec.matchPageDims.width;
          const mH = spec.matchPageDims.height;
          const long = Math.max(mW, mH);
          const short = Math.min(mW, mH);
          const landscape = spec.orientation === 'landscape'
            || (spec.orientation !== 'portrait' && mW > mH);
          paperW = landscape ? long : short;
          paperH = landscape ? short : long;
          console.log('[PrintPanel→App] match paper:',
            `matchDims=${mW}x${mH}`,
            `orientation=${spec.orientation}`,
            `landscape=${landscape}`,
            `→ sheet ${paperW}x${paperH}`);
        } else {
          const dim = PAPER_DIM_INCHES[spec.paperSize] || [8.5, 11];
          // UX 2026-04-24: "auto" adapts the paper to each page's own
          // orientation — landscape pages get landscape paper, portrait
          // pages get portrait. Explicit Portrait/Landscape force.
          const landscape = spec.orientation === 'landscape'
            || (spec.orientation === 'auto' && (img.width / img.height) > 1);
          paperW = landscape ? Math.max(dim[0], dim[1]) : Math.min(dim[0], dim[1]);
          paperH = landscape ? Math.min(dim[0], dim[1]) : Math.max(dim[0], dim[1]);
        }
        const fitRule = spec.fitMode === 'stretch' ? 'fill' : 'contain';
        const bwRule = spec.bw ? 'filter: grayscale(1);' : '';
        const pageId = `p-${idx}`;
        return `
          <style>
            @page ${pageId ? `:nth-of-type(${idx + 1})` : ''} {
              size: ${paperW}in ${paperH}in;
              margin: 0;
            }
          </style>
          <section class="sheet" style="
            width: ${paperW}in;
            height: ${paperH}in;
          ">
            <img src="${img.src}" alt="Page ${spec.pageNumber}" style="
              width: 100%;
              height: 100%;
              object-fit: ${fitRule};
              ${bwRule}
              display: block;
            " />
          </section>
        `;
      }).join('\n');
      const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Print — ${String(jobSpec.docName || 'document').replace(/[<>&"']/g, '')}</title>
<style>
  html, body { margin: 0; padding: 0; background: #fff; }
  .sheet { page-break-after: always; break-after: page; overflow: hidden; background: #fff; }
  .sheet:last-child { page-break-after: auto; break-after: auto; }
  img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media print {
    html, body { background: #fff; }
  }
</style>
</head>
<body>
${pageBlocks}
</body>
</html>`;

      // 3. Hand the composed HTML to the main process, which loads it
      //    in a hidden window and prints silently — no OS dialog. Falls
      //    back to the legacy iframe-print path if the bridge is missing
      //    (browser/dev-mode without Electron preload).
      const job = jobSpec.job || {};
      const dest = job.destination;
      const isSavePdf = dest === 'save-pdf' || dest === 'pdf';
      const firstSpec = perPageRenders[0]?.spec;
      const firstImg = perPageRenders[0]?.img;
      let firstLandscape = false;
      if (firstSpec && firstImg) {
        if (firstSpec.paperSize === 'match' && firstSpec.matchPageDims) {
          firstLandscape = firstSpec.orientation === 'landscape'
            || (firstSpec.orientation !== 'portrait' && firstSpec.matchPageDims.width > firstSpec.matchPageDims.height);
        } else if (firstSpec.paperSize === 'auto') {
          firstLandscape = (firstImg.width / firstImg.height) > 1;
        } else {
          firstLandscape = firstSpec.orientation === 'landscape'
            || (firstSpec.orientation === 'auto' && (firstImg.width / firstImg.height) > 1);
        }
      }
      const printOptions = {
        deviceName: dest && dest !== 'save-pdf' && dest !== 'pdf' ? dest : undefined,
        copies: Math.max(1, parseInt(job.copies, 10) || 1),
        collate: job.collate !== false,
        color: jobSpec.settings?.colorOn !== false,
        printBackground: true,
        landscape: firstLandscape,
        duplexMode: job.duplex === true || job.duplex === 'long-edge'
          ? 'longEdge'
          : (job.duplex === 'short-edge' ? 'shortEdge' : 'simplex'),
      };
      let used = 'iframe';
      // UX 2026-04-24: when the caller asks for the OS native print
      // dialog (so the user gets the system's built-in preview pane on
      // Windows + macOS), force the iframe path even in Electron. The
      // silent path is only used when the custom panel collected an
      // explicit destination.
      const forceNativeDialog = jobSpec.useNativeDialog === true;
      if (isSavePdf && !forceNativeDialog && typeof window !== 'undefined' && window.electronAPI?.printHtmlToPdf) {
        used = 'electron-pdf';
        const safeName = String(jobSpec.docName || 'Print').replace(/[\\/:*?"<>|]/g, '_');
        const result = await window.electronAPI.printHtmlToPdf({
          html,
          suggestedName: `${safeName} (print).pdf`,
          options: printOptions,
        });
        console.log('[PrintPanel] electron printHtmlToPdf →',
          'ok=', result?.ok, 'filePath=', result?.filePath || '(none)', 'error=', result?.error || '(none)');
      } else if (!forceNativeDialog && typeof window !== 'undefined' && window.electronAPI?.printHtmlSilent) {
        used = 'electron-silent';
        const result = await window.electronAPI.printHtmlSilent({ html, options: printOptions });
        console.log('[PrintPanel] electron printHtmlSilent →',
          'ok=', result?.ok, 'error=', result?.error || '(none)');
      } else {
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.srcdoc = html;
        document.body.appendChild(iframe);
        const waitLoad = new Promise((resolve) => {
          iframe.addEventListener('load', () => resolve(), { once: true });
          setTimeout(resolve, 5000);
        });
        await waitLoad;
        try {
          const win = iframe.contentWindow;
          if (win) { win.focus(); win.print(); }
        } catch (err) {
          console.error('[PrintPanel] iframe print() failed:', err);
        }
        setTimeout(() => { try { iframe.remove(); } catch {} }, 2000);
      }
      console.log('[PrintPanel] print dispatched via', used, 'destination=', dest);
    } catch (err) {
      console.error('[PrintPanel] print pipeline error:', err);
    }
    setPrintPanelOpen(false);
  }, [printPanelGetThumbnail, setPrintPanelOpen]);

  return {
    printPanelPages,
    printPanelGetThumbnail,
    getPageContentRotation,
    handlePrintPanelPrint,
  };
}
