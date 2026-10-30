// src/components/VersionCompareDialog.jsx
//
// Lay an older version over a newer one (Drawboard Projects' overlay compare;
// Nightly, flag 'document-versions'). The old version is red, the new one
// blue, and what both share is black (src/utils/versionCompare.js). The
// arrow keys nudge the old version a point at a time (Shift: 10) when the two
// sheets were plotted a little apart.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import DialogCard from './DialogCard.jsx';
import { Icon } from '../home/HubShell';
import { C } from '../uiPalette';
import { Z_INDEX } from '../theme';
import { useTooltip } from './Tooltip';
import { supabase } from '../supabaseClient';
import { loadPdfjs } from '../utils/pdfWorkerConfig.js';
import { pdfjsAssetOptions } from '../utils/pdfjsAssets.js';
import {
  COMPARE_NEW_INK,
  COMPARE_OLD_INK,
  clampZoom,
  comparePageCount,
  composeOverlay,
  fitZoom,
  inkCanvas,
  nudgeOffset,
} from '../utils/versionCompare.js';

async function openVersionPdf(documentId) {
  const { data: row, error } = await supabase.from('documents').select('id, file_path').eq('id', documentId).single();
  if (error || !row?.file_path) throw new Error('Could not find that version');
  const { data: blob, error: downloadError } = await supabase.storage.from('documents').download(row.file_path);
  if (downloadError || !blob) throw new Error('Could not download that version');
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), ...pdfjsAssetOptions(pdfjs) }).promise;
}

async function renderInked(pdf, pageNumber, pixelsPerPoint, ink) {
  if (!pdf || pageNumber > pdf.numPages) return null;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: pixelsPerPoint });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(255, 255, 255)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  inkCanvas(ctx, canvas.width, canvas.height, ink);
  return { canvas, widthPt: viewport.width / pixelsPerPoint, heightPt: viewport.height / pixelsPerPoint };
}

async function pageSizePt(pdf, pageNumber) {
  if (!pdf || pageNumber > pdf.numPages) return null;
  const viewport = (await pdf.getPage(pageNumber)).getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

const swatch = (ink) => ({ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: ink, marginRight: 6, verticalAlign: '-1px' });

export default function VersionCompareDialog({ older, newer, onClose }) {
  const tip = useTooltip();
  const viewRef = useRef(null);
  const canvasRef = useRef(null);
  const [pdfs, setPdfs] = useState(null);
  const [failed, setFailed] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(null); // null = fit
  // The scale the page was last drawn at (the fitted one while zoom is null),
  // so the first zoom step leaves Fit from where the page really is.
  const drawnZoom = useRef(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [showOld, setShowOld] = useState(true);
  const [showNew, setShowNew] = useState(true);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([openVersionPdf(older.id), openVersionPdf(newer.id)])
      .then(([oldPdf, newPdf]) => { if (!cancelled) setPdfs({ oldPdf, newPdf }); })
      .catch((err) => { if (!cancelled) setFailed(err?.message || 'Could not open the versions'); });
    return () => { cancelled = true; };
  }, [older.id, newer.id]);
  useEffect(() => () => {
    pdfs?.oldPdf?.destroy?.();
    pdfs?.newPdf?.destroy?.();
  }, [pdfs]);

  const pageCount = pdfs ? comparePageCount(pdfs.oldPdf.numPages, pdfs.newPdf.numPages) : 0;

  // Draw the page whenever what is shown changes; a newer draw wins.
  const drawId = useRef(0);
  useLayoutEffect(() => {
    if (!pdfs) return undefined;
    const id = ++drawId.current;
    let cancelled = false;
    (async () => {
      setBusy(true);
      const [oldSize, newSize] = await Promise.all([
        pageSizePt(pdfs.oldPdf, pageNumber),
        pageSizePt(pdfs.newPdf, pageNumber),
      ]);
      const widthPt = Math.max(oldSize?.width || 0, newSize?.width || 0);
      const heightPt = Math.max(oldSize?.height || 0, newSize?.height || 0);
      const view = viewRef.current;
      const effectiveZoom = zoom ?? fitZoom(widthPt, heightPt, (view?.clientWidth || 800) - 16, (view?.clientHeight || 600) - 16);
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const pixelsPerPoint = effectiveZoom * dpr;
      const [newLayer, oldLayer] = await Promise.all([
        showNew ? renderInked(pdfs.newPdf, pageNumber, pixelsPerPoint, COMPARE_NEW_INK) : null,
        showOld ? renderInked(pdfs.oldPdf, pageNumber, pixelsPerPoint, COMPARE_OLD_INK) : null,
      ]);
      if (cancelled || id !== drawId.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.ceil(widthPt * pixelsPerPoint);
      canvas.height = Math.ceil(heightPt * pixelsPerPoint);
      drawnZoom.current = effectiveZoom;
      canvas.style.width = `${Math.round(widthPt * effectiveZoom)}px`;
      canvas.style.height = `${Math.round(heightPt * effectiveZoom)}px`;
      composeOverlay(canvas.getContext('2d'), {
        width: canvas.width,
        height: canvas.height,
        newLayer: newLayer?.canvas || null,
        oldLayer: oldLayer?.canvas || null,
        offset,
        pixelsPerPoint,
      });
      canvas.dataset.comparePage = String(pageNumber);
      canvas.dataset.compareOffset = `${offset.x},${offset.y}`;
      setBusy(false);
    })().catch((err) => {
      if (!cancelled) setFailed(err?.message || 'Could not draw the page');
    });
    return () => { cancelled = true; };
  }, [pdfs, pageNumber, zoom, offset, showOld, showNew]);

  const onKeyDown = useCallback((e) => {
    if (e.target?.closest?.('button') && (e.key === 'Enter' || e.key === ' ')) return;
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      setOffset((current) => nudgeOffset(current, e.key, e.shiftKey));
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      setPageNumber((n) => Math.min(pageCount, n + 1));
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      setPageNumber((n) => Math.max(1, n - 1));
    }
  }, [pageCount]);

  const zoomBy = (factor) => {
    setZoom(clampZoom((zoom ?? drawnZoom.current) * factor));
  };
  const iconButton = (label, icon, onClick, disabled = false) => (
    <button type="button" className="hub-icon-btn" aria-label={label} {...tip(label)} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={13} />
    </button>
  );

  return (
    <DialogCard
      title={`Compare v${older.versionNumber} with v${newer.versionNumber}`}
      message={(
        <span>
          <span style={swatch(COMPARE_OLD_INK)} />Only in v{older.versionNumber}
          <span style={{ ...swatch(COMPARE_NEW_INK), marginLeft: 14 }} />Only in v{newer.versionNumber}
          <span style={{ ...swatch('rgb(0, 0, 0)'), marginLeft: 14 }} />In both. Arrow keys nudge v{older.versionNumber} (Shift: 10 pt).
        </span>
      )}
      onClose={onClose}
      width="min(1200px, 96vw)"
      zIndex={Z_INDEX.modalOverlay}
      cardProps={{ 'data-version-compare': 'true', onKeyDown }}
      footer={(
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto', flexWrap: 'wrap' }}>
            {iconButton('Previous page', 'chevronLeft', () => setPageNumber((n) => Math.max(1, n - 1)), pageNumber <= 1)}
            <span data-compare-page-label="true" style={{ fontSize: 12, color: C.muted, minWidth: 74, textAlign: 'center' }}>
              Page {pageNumber} of {pageCount || '…'}
            </span>
            {iconButton('Next page', 'chevronRight', () => setPageNumber((n) => Math.min(pageCount, n + 1)), pageNumber >= pageCount)}
            {iconButton('Zoom out', 'minus', () => zoomBy(1 / 1.25))}
            {iconButton('Zoom in', 'plus', () => zoomBy(1.25))}
            <button type="button" className="hub-btn dialog-touch-pad" onClick={() => setZoom(null)}>Fit</button>
            <button type="button" className="hub-btn dialog-touch-pad" disabled={!offset.x && !offset.y} onClick={() => setOffset({ x: 0, y: 0 })}>
              Reset nudge
            </button>
          </div>
          <button type="button" className={`hub-btn dialog-touch-pad${showOld ? ' is-active' : ''}`} aria-pressed={showOld} onClick={() => setShowOld((v) => !v)}>
            v{older.versionNumber}
          </button>
          <button type="button" className={`hub-btn dialog-touch-pad${showNew ? ' is-active' : ''}`} aria-pressed={showNew} onClick={() => setShowNew((v) => !v)}>
            v{newer.versionNumber}
          </button>
        </>
      )}
    >
      <div
        ref={viewRef}
        tabIndex={0}
        aria-label="Overlay of the two versions"
        style={{
          height: 'calc(100dvh - 230px)', minHeight: 240, overflow: 'auto', background: C.deep,
          borderRadius: 'var(--radius-sm)', display: 'grid', placeItems: 'center', position: 'relative', outline: 'none',
        }}
      >
        {failed ? (
          <div role="alert" style={{ color: C.muted, padding: 24 }}>{failed}</div>
        ) : (
          <canvas ref={canvasRef} data-compare-canvas="true" aria-busy={busy} style={{ margin: 8, boxShadow: 'var(--shadow-dialog)', background: 'rgb(255, 255, 255)' }} />
        )}
        {!failed && !pdfs && (
          <div style={{ position: 'absolute', color: C.muted }}>Opening both versions…</div>
        )}
      </div>
    </DialogCard>
  );
}
