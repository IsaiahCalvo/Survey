// src/components/VersionCompareDialog.jsx
//
// Lay older versions over a newer one (Drawboard Projects' overlay compare;
// Nightly, flag 'document-versions'). Like Drawboard, the new version is red
// and the old one blue by default, and what they share is black
// (src/utils/versionCompare.js). Each layer can take its own ink; an older
// layer can be moved (arrow keys: a point, Shift: 10), scaled and turned when
// the sheets were plotted differently, and up to three older versions can be
// laid over at once (trial audit 2026-11-09).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import DialogCard from './DialogCard.jsx';
import ValueSelect from './ValueSelect.jsx';
import { Icon } from '../home/HubShell';
import { C } from '../uiPalette';
import { Z_INDEX } from '../theme';
import { useTooltip } from './Tooltip';
import { supabase } from '../supabaseClient';
import { loadPdfjs } from '../utils/pdfWorkerConfig.js';
import { pdfjsAssetOptions } from '../utils/pdfjsAssets.js';
import {
  MAX_OVERLAYS,
  OVERLAY_INKS,
  clampOverlayScale,
  clampZoom,
  comparePageCount,
  composeLayers,
  fitZoom,
  inkCanvas,
  inkRgb,
  makeOverlayLayer,
  normalizeRotation,
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
const fieldStyle = {
  width: 64, height: 28, padding: '0 6px', fontSize: 12, borderRadius: 'var(--radius-sm)',
  border: `1px solid ${C.rule}`, background: C.deep, color: C.ink,
};
const cardStyle = (active) => ({
  display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 'var(--radius-sm)',
  border: `1px solid ${active ? C.gold : C.rule}`, background: C.card, minWidth: 0,
});

// Rendered layers are kept, so moving, scaling or turning one only redraws
// the overlay, never the PDF pages.
const RENDER_CACHE_SIZE = 12;

function InkPicker({ value, onChange, versionNumber, tip }) {
  return (
    <div role="radiogroup" aria-label={`Colour of v${versionNumber}`} style={{ display: 'flex', gap: 4 }}>
      {OVERLAY_INKS.map((ink) => (
        <button
          key={ink.key}
          type="button"
          role="radio"
          aria-checked={value === ink.key}
          aria-label={`${ink.label} for v${versionNumber}`}
          data-compare-ink={ink.key}
          {...tip(ink.label)}
          onClick={() => onChange(ink.key)}
          className="dialog-touch-pad"
          style={{
            width: 18, height: 18, borderRadius: 4, background: ink.rgb, padding: 0, cursor: 'pointer',
            border: value === ink.key ? `2px solid ${C.ink}` : `1px solid ${C.rule}`,
          }}
        />
      ))}
    </div>
  );
}

function NumberField({ label, value, onCommit, suffix, step = 1 }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n)) onCommit(n);
    else setText(String(value));
  };
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.muted }}>
      {label}
      <input
        type="number"
        inputMode="decimal"
        step={step}
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
        }}
        style={fieldStyle}
      />
      {suffix}
    </label>
  );
}

export default function VersionCompareDialog({ older, newer, versions = [], onClose }) {
  const tip = useTooltip();
  const viewRef = useRef(null);
  const canvasRef = useRef(null);
  const [pdfs, setPdfs] = useState({}); // version id -> pdf.js document
  const [failed, setFailed] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(null); // null = fit
  // The scale the page was last drawn at (the fitted one while zoom is null),
  // so the first zoom step leaves Fit from where the page really is.
  const drawnZoom = useRef(1);
  const [base, setBase] = useState({ ink: 'red', visible: true });
  const [layers, setLayers] = useState(() => [makeOverlayLayer(older, ['red'])]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [shownZoom, setShownZoom] = useState(null);
  const [busy, setBusy] = useState(true);
  const renders = useRef(new Map());

  const active = layers[Math.min(activeIndex, layers.length - 1)] || null;
  const wanted = [newer, ...layers.map((l) => l.version)];
  const wantedKey = wanted.map((v) => v.id).join(',');

  // Open each version once; a layer added later opens then.
  useEffect(() => {
    let cancelled = false;
    // A new set of versions starts clean, so taking off a layer that would
    // not open brings the overlay back.
    setFailed(null);
    const missing = wanted.filter((v) => !pdfs[v.id]);
    if (!missing.length) return undefined;
    // A load that is cancelled (a layer added mid-open, unmount) or that
    // half-fails closes what it did open, so no pdf.js document is left behind.
    Promise.allSettled(missing.map((v) => openVersionPdf(v.id).then((pdf) => [v.id, pdf])))
      .then((results) => {
        const opened = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
        const failure = results.find((r) => r.status === 'rejected');
        if (cancelled) {
          for (const [, pdf] of opened) pdf?.destroy?.();
          return;
        }
        if (failure) setFailed(failure.reason?.message || 'Could not open the versions');
        setPdfs((current) => ({ ...current, ...Object.fromEntries(opened) }));
      });
    return () => { cancelled = true; };
  }, [wantedKey]);
  const pdfsRef = useRef(pdfs);
  pdfsRef.current = pdfs;
  useEffect(() => () => {
    for (const pdf of Object.values(pdfsRef.current)) pdf?.destroy?.();
  }, []);

  const ready = wanted.every((v) => pdfs[v.id]);
  const pageCount = ready ? wanted.reduce((n, v) => comparePageCount(n, pdfs[v.id].numPages), 0) : 0;

  const renderLayer = useCallback(async (version, page, pixelsPerPoint, ink) => {
    const key = `${version.id}|${page}|${pixelsPerPoint}|${ink}`;
    const cache = renders.current;
    if (cache.has(key)) return cache.get(key);
    const result = await renderInked(pdfs[version.id], page, pixelsPerPoint, inkRgb(ink));
    cache.set(key, result);
    while (cache.size > RENDER_CACHE_SIZE) cache.delete(cache.keys().next().value);
    return result;
  }, [pdfs]);

  // Draw the page whenever what is shown changes; a newer draw wins.
  const drawId = useRef(0);
  useLayoutEffect(() => {
    if (!ready) return undefined;
    const id = ++drawId.current;
    let cancelled = false;
    (async () => {
      setBusy(true);
      const size = await pageSizePt(pdfs[newer.id], pageNumber)
        || (await Promise.all(layers.map((l) => pageSizePt(pdfs[l.version.id], pageNumber)))).find(Boolean)
        || { width: 612, height: 792 };
      const view = viewRef.current;
      const effectiveZoom = zoom ?? fitZoom(size.width, size.height, (view?.clientWidth || 800) - 16, (view?.clientHeight || 600) - 16);
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const pixelsPerPoint = effectiveZoom * dpr;
      const [baseLayer, ...overlayLayers] = await Promise.all([
        base.visible ? renderLayer(newer, pageNumber, pixelsPerPoint, base.ink) : null,
        ...layers.map((l) => (l.visible ? renderLayer(l.version, pageNumber, pixelsPerPoint, l.ink) : null)),
      ]);
      if (cancelled || id !== drawId.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = Math.ceil(size.width * pixelsPerPoint);
      canvas.height = Math.ceil(size.height * pixelsPerPoint);
      drawnZoom.current = effectiveZoom;
      setShownZoom(effectiveZoom);
      canvas.style.width = `${Math.round(size.width * effectiveZoom)}px`;
      canvas.style.height = `${Math.round(size.height * effectiveZoom)}px`;
      composeLayers(canvas.getContext('2d'), {
        width: canvas.width,
        height: canvas.height,
        base: baseLayer?.canvas || null,
        layers: layers.map((l, i) => ({ ...l, canvas: overlayLayers[i]?.canvas || null })),
        pixelsPerPoint,
      });
      canvas.dataset.comparePage = String(pageNumber);
      canvas.dataset.compareLayers = String(1 + layers.length);
      canvas.dataset.compareOffset = active ? `${active.offset.x},${active.offset.y}` : '0,0';
      canvas.dataset.compareTransform = active ? `${Math.round(active.scale * 100)},${active.rotation}` : '100,0';
      setBusy(false);
    })().catch((err) => {
      if (!cancelled) setFailed(err?.message || 'Could not draw the page');
    });
    return () => { cancelled = true; };
  }, [ready, pdfs, newer, pageNumber, zoom, base, layers, active, renderLayer]);

  const updateLayer = useCallback((index, patch) => {
    setLayers((current) => current.map((l, i) => (i === index ? { ...l, ...(typeof patch === 'function' ? patch(l) : patch) } : l)));
  }, []);

  const onKeyDown = useCallback((e) => {
    if (e.target?.closest?.('button') && (e.key === 'Enter' || e.key === ' ')) return;
    if (e.target?.closest?.('input, select')) return;
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      updateLayer(activeIndex, (l) => ({ offset: nudgeOffset(l.offset, e.key, e.shiftKey) }));
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      setPageNumber((n) => Math.min(pageCount, n + 1));
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      setPageNumber((n) => Math.max(1, n - 1));
    }
  }, [pageCount, activeIndex, updateLayer]);

  const usedIds = new Set(wanted.map((v) => v.id));
  const addable = (versions || []).filter((v) => !usedIds.has(v.id));
  const addLayer = (id) => {
    const version = addable.find((v) => v.id === id);
    if (!version || layers.length >= MAX_OVERLAYS) return;
    setLayers((current) => [...current, makeOverlayLayer(version, [base.ink, ...current.map((l) => l.ink)])]);
    setActiveIndex(layers.length);
  };
  const removeLayer = (index) => {
    setLayers((current) => current.filter((_, i) => i !== index));
    setActiveIndex((i) => Math.max(0, i >= index ? i - 1 : i));
  };

  const zoomBy = useCallback((factor) => {
    setZoom((current) => clampZoom((current ?? drawnZoom.current) * factor));
  }, []);
  // Ctrl/Cmd + wheel (and a trackpad pinch, which arrives as one) zooms the
  // overlay, as it does on the page itself.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    view.addEventListener('wheel', onWheel, { passive: false });
    return () => view.removeEventListener('wheel', onWheel);
  }, [zoomBy]);
  const iconButton = (label, icon, onClick, disabled = false) => (
    <button type="button" className="hub-icon-btn" aria-label={label} {...tip(label)} onClick={onClick} disabled={disabled}>
      <Icon name={icon} size={13} />
    </button>
  );
  const moved = active && (active.offset.x || active.offset.y || active.scale !== 1 || active.rotation);
  const title = layers.length === 1
    ? `Compare v${layers[0].version.versionNumber} with v${newer.versionNumber}`
    : `Compare ${layers.map((l) => `v${l.version.versionNumber}`).join(', ')} with v${newer.versionNumber}`;

  return (
    <DialogCard
      title={title}
      message={(
        <span>
          <span style={swatch(inkRgb(base.ink))} />Only in v{newer.versionNumber}
          {layers.map((l) => (
            <span key={l.version.id}>
              <span style={{ ...swatch(inkRgb(l.ink)), marginLeft: 14 }} />Only in v{l.version.versionNumber}
            </span>
          ))}
          <span style={{ ...swatch('rgb(0, 0, 0)'), marginLeft: 14 }} />In both. Arrow keys move the chosen layer (Shift: 10 pt).
        </span>
      )}
      onClose={onClose}
      width="min(1200px, 96vw)"
      zIndex={Z_INDEX.modalOverlay}
      cardProps={{ 'data-version-compare': 'true', onKeyDown }}
      footer={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 'auto', flexWrap: 'wrap' }}>
          {iconButton('Previous page', 'chevronLeft', () => setPageNumber((n) => Math.max(1, n - 1)), pageNumber <= 1)}
          <span data-compare-page-label="true" style={{ fontSize: 12, color: C.muted, minWidth: 74, textAlign: 'center' }}>
            Page {pageNumber} of {pageCount || '…'}
          </span>
          {iconButton('Next page', 'chevronRight', () => setPageNumber((n) => Math.min(pageCount, n + 1)), pageNumber >= pageCount)}
          {iconButton('Zoom out', 'minus', () => zoomBy(1 / 1.25))}
          <button
            type="button"
            className="hub-btn dialog-touch-pad nums"
            data-compare-zoom="true"
            aria-label="Fit page"
            {...tip('Fit page')}
            onClick={() => setZoom(null)}
            style={{ minWidth: 58 }}
          >
            {shownZoom ? `${Math.round(shownZoom * 100)}%` : 'Fit'}
          </button>
          {iconButton('Zoom in', 'plus', () => zoomBy(1.25))}
        </div>
      )}
    >
      <div data-compare-layer-list="true" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'stretch' }}>
        <div style={cardStyle(false)} data-compare-layer="base">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className={`hub-btn dialog-touch-pad${base.visible ? ' is-active' : ''}`}
              aria-pressed={base.visible}
              aria-label={`Show v${newer.versionNumber}`}
              {...tip(base.visible ? 'Hide' : 'Show')}
              onClick={() => setBase((b) => ({ ...b, visible: !b.visible }))}
            >
              v{newer.versionNumber}
            </button>
            <InkPicker value={base.ink} versionNumber={newer.versionNumber} tip={tip} onChange={(ink) => setBase((b) => ({ ...b, ink }))} />
          </div>
          <span style={{ fontSize: 11, color: C.muted }}>Underneath</span>
        </div>
        {layers.map((layer, index) => {
          const isActive = index === activeIndex;
          const n = layer.version.versionNumber;
          return (
            <div
              key={layer.version.id}
              style={cardStyle(isActive)}
              data-compare-layer={String(n)}
              data-active={isActive ? 'true' : undefined}
              onPointerDown={() => setActiveIndex(index)}
              onFocusCapture={() => setActiveIndex(index)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className={`hub-btn dialog-touch-pad${layer.visible ? ' is-active' : ''}`}
                  aria-pressed={layer.visible}
                  aria-label={`Show v${n}`}
                  {...tip(layer.visible ? 'Hide' : 'Show')}
                  onClick={() => updateLayer(index, (l) => ({ visible: !l.visible }))}
                >
                  v{n}
                </button>
                <InkPicker value={layer.ink} versionNumber={n} tip={tip} onChange={(ink) => updateLayer(index, { ink })} />
                {layers.length > 1 && (
                  <button type="button" className="hub-icon-btn" aria-label={`Take v${n} off`} {...tip('Take off')} onClick={() => removeLayer(index)}>
                    <Icon name="close" size={12} />
                  </button>
                )}
              </div>
              {isActive && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <NumberField label="X" value={layer.offset.x} suffix="pt" onCommit={(x) => updateLayer(index, (l) => ({ offset: { ...l.offset, x } }))} />
                  <NumberField label="Y" value={layer.offset.y} suffix="pt" onCommit={(y) => updateLayer(index, (l) => ({ offset: { ...l.offset, y } }))} />
                  <NumberField label="Scale" value={Math.round(layer.scale * 1000) / 10} suffix="%" step={0.1} onCommit={(pct) => updateLayer(index, { scale: clampOverlayScale(pct / 100) })} />
                  <NumberField label="Turn" value={layer.rotation} suffix="°" step={0.5} onCommit={(deg) => updateLayer(index, { rotation: normalizeRotation(deg) })} />
                  <button
                    type="button"
                    className="hub-btn dialog-touch-pad"
                    disabled={!moved}
                    onClick={() => updateLayer(index, { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 })}
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {addable.length > 0 && layers.length < MAX_OVERLAYS && (
          <div data-compare-add-layer="true" style={{ ...cardStyle(false), justifyContent: 'center', fontSize: 12, color: C.muted, gap: 6 }}>
            <span aria-hidden="true">Lay over another</span>
            <ValueSelect
              label="Lay over another version"
              size="sm"
              width="auto"
              value=""
              placeholder="Pick a version"
              options={addable.map((v) => ({ value: v.id, label: `v${v.versionNumber}` }))}
              onChange={(id) => addLayer(id)}
            />
          </div>
        )}
      </div>
      <div
        ref={viewRef}
        tabIndex={0}
        aria-label="Overlay of the versions"
        style={{
          height: 'calc(100dvh - 320px)', minHeight: 240, overflow: 'auto', background: C.deep,
          borderRadius: 'var(--radius-sm)', display: 'grid', placeItems: 'center', position: 'relative', outline: 'none',
        }}
      >
        {failed ? (
          <div role="alert" style={{ color: C.muted, padding: 24 }}>{failed}</div>
        ) : (
          <canvas ref={canvasRef} data-compare-canvas="true" aria-busy={busy} style={{ margin: 8, boxShadow: 'var(--shadow-dialog)', background: 'rgb(255, 255, 255)' }} />
        )}
        {!failed && !ready && (
          <div style={{ position: 'absolute', color: C.muted }}>Opening the versions…</div>
        )}
      </div>
    </DialogCard>
  );
}
