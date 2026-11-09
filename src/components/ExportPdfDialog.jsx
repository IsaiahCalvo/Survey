/* Export PDF with choices (Nightly, flag 'export-modes'; owner 2026-10-26).
   Marks: annotated (editable), flattened (burned in) or plain (none).
   Pages: every page, this page, pages with marks, or a typed list.
   The same card, head and foot as the PDF tools dialog, so it reads as one
   family. Owner 2026-11-09 ("looks like shit, make it more professional"):
   the mark choices are cards with a small page picture of what you get, the
   pages are a print-dialog style list with counts, and the foot says what
   will be made. The viewer does the work: api.exportPdfWithOptions(choice)
   resolves { ok, error?, canceled? }; api.exportPageInfo() gives the page
   count, the page on screen and the pages that carry marks. */
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../home/HubShell';
import { useFocusTrap } from '../hooks/useFocusTrap';
import Spinner from './Spinner';
import MotionPresence from './MotionPresence.jsx';
import { C } from '../uiPalette';
import { EXPORT_MARK_MODES, parsePageList } from '../utils/exportPdfModes.js';
import './PdfToolsDialog.css';
import ButtonGroup from './ButtonGroup.jsx';
import './ExportPdfDialog.css';

// A small page picture for each mark choice: editable marks carry handles,
// flattened marks are part of the page, plain is the bare drawing.
function MarkModePreview({ mode }) {
  const marks = mode !== 'plain';
  return (
    <svg className="xpdf-preview" viewBox="0 0 64 48" aria-hidden="true" focusable="false">
      <rect x="14" y="3" width="36" height="42" rx="2" className="xpdf-preview__page" />
      <path d="M19 12h20M19 17h26M19 22h14M19 36h22M19 40h16" className="xpdf-preview__lines" />
      {marks && <rect x="22" y="25" width="18" height="8" rx="1" className="xpdf-preview__mark" />}
      {marks && <circle cx="42" cy="13" r="4.5" className="xpdf-preview__mark" />}
      {mode === 'annotated' && (
        <g className="xpdf-preview__handles">
          <rect x="20.5" y="23.5" width="3" height="3" />
          <rect x="38.5" y="23.5" width="3" height="3" />
          <rect x="20.5" y="31.5" width="3" height="3" />
          <rect x="38.5" y="31.5" width="3" height="3" />
        </g>
      )}
    </svg>
  );
}

export default function ExportPdfDialog({ open, api, fileName = '', onClose }) {
  const cardRef = useRef(null);
  const [mode, setMode] = useState('annotated');
  const [pages, setPages] = useState('all');
  const [custom, setCustom] = useState('');
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useFocusTrap(cardRef, open, { onEscape: busy ? undefined : onClose });

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setError('');
    setInfo(null);
    Promise.resolve(api?.exportPageInfo?.()).then((next) => { if (live) setInfo(next || null); }).catch(() => {});
    return () => { live = false; };
  }, [open, api]);

  if (!open) return <MotionPresence open={false} />;

  const numPages = info?.numPages || 0;
  const marked = info?.marked || [];
  const pageChoices = [
    { id: 'all', label: 'All pages', count: numPages || null },
    { id: 'current', label: 'This page', detail: info?.currentPage ? `Page ${info.currentPage}` : '' , count: info?.currentPage ? 1 : null },
    { id: 'marked', label: 'Pages with marks', count: info ? marked.length : null, disabled: Boolean(info && !marked.length) },
    { id: 'custom', label: 'Choose pages', count: null },
  ];
  const customCheck = pages === 'custom' && custom.trim() && numPages ? parsePageList(custom, numPages) : null;
  const pageCount = pages === 'all' ? numPages
    : pages === 'current' ? 1
      : pages === 'marked' ? marked.length
        : customCheck?.pages?.length || 0;
  const modeLabel = { annotated: 'editable marks', flattened: 'marks burned in', plain: 'no marks' }[mode] || '';
  const summary = pageCount ? `${pageCount} page${pageCount === 1 ? '' : 's'} · ${modeLabel}` : modeLabel;

  const run = async () => {
    if (!api?.exportPdfWithOptions) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.exportPdfWithOptions({ mode, pages, custom });
      if (result?.ok || result?.canceled) {
        if (result?.ok) onClose();
        return;
      }
      setError(result?.error || 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <MotionPresence open>
      <div className="pdft-overlay" style={{ background: C.scrim }} onClick={busy ? undefined : onClose}>
        <div ref={cardRef} role="dialog" aria-modal="true" aria-label="Export PDF" className="pdft-card" data-export-pdf-dialog="true" onClick={(e) => e.stopPropagation()}>
          <div className="pdft-head">
            <span className="xpdf-head-icon" aria-hidden="true"><Icon name="document" size={16} /></span>
            <div className="pdft-title">
              <div className="pdft-h">Export PDF</div>
              {fileName ? <div className="pdft-sub">{fileName}</div> : null}
            </div>
            <button type="button" className="hub-icon-btn dialog-touch-pad" aria-label="Close" onClick={onClose} disabled={busy}><Icon name="close" size={13} /></button>
          </div>
          <div className="pdft-body xpdf-body">
            <div className="xpdf-section">
              <span className="xpdf-label" id="export-pdf-marks">Marks</span>
              <ButtonGroup
                labelledBy="export-pdf-marks"
                fill
                className="xpdf-modes"
                value={mode}
                options={EXPORT_MARK_MODES.map((m) => ({ value: m.id, label: m.label, ariaLabel: `${m.label}. ${m.short}` }))}
                onChange={setMode}
              />
              {/* What the chosen way looks like on the page, and what it means. */}
              <div className="xpdf-mode-detail" data-export-mode-detail={mode}>
                <MarkModePreview mode={mode} />
                <p>{EXPORT_MARK_MODES.find((m) => m.id === mode)?.short}</p>
              </div>
            </div>
            <div className="xpdf-section">
              <span className="xpdf-label" id="export-pdf-pages">Pages</span>
              <div className="xpdf-pages" role="radiogroup" aria-labelledby="export-pdf-pages">
                {pageChoices.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={pages === c.id}
                    aria-label={c.id === 'all' && numPages ? `All ${numPages} pages` : c.id === 'current' && info?.currentPage ? `This page (${info.currentPage})` : c.id === 'marked' && info ? `Pages with marks (${marked.length})` : c.label}
                    disabled={c.disabled}
                    className={`xpdf-page${pages === c.id ? ' is-on' : ''}`}
                    onClick={() => { setPages(c.id); setError(''); }}
                  >
                    <span className="xpdf-radio" aria-hidden="true" />
                    <span className="xpdf-page__label">{c.label}</span>
                    {c.detail ? <span className="xpdf-page__detail">{c.detail}</span> : null}
                    {c.count != null ? <span className="xpdf-page__count">{c.count}</span> : null}
                  </button>
                ))}
              </div>
              {pages === 'custom' && (
                <div className="xpdf-custom">
                  <input
                    className="pdft-input"
                    aria-label="Pages to export"
                    placeholder={numPages > 3 ? `Like 1-3, ${numPages}` : 'Like 1-2'}
                    value={custom}
                    autoFocus
                    onChange={(e) => { setCustom(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !busy) run(); }}
                  />
                  <p className={`pdft-help${customCheck?.error ? ' is-error' : ''}`}>
                    {customCheck?.pages ? `${customCheck.pages.length} page${customCheck.pages.length === 1 ? '' : 's'}` : customCheck?.error || 'Pages and ranges, split by commas.'}
                  </p>
                </div>
              )}
            </div>
            {error && <p className="pdft-error" role="alert">{error}</p>}
          </div>
          <div className="pdft-foot">
            {busy
              ? <span className="pdft-busy" role="status"><Spinner size={14} color="currentColor" /> Making the PDF…</span>
              : <span className="xpdf-summary" aria-live="polite">{summary}</span>}
            <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad xpdf-go" onClick={run} disabled={busy || (pages === 'custom' && !customCheck?.pages)}>
              <Icon name="download" size={14} />
              <span>Export</span>
            </button>
          </div>
        </div>
      </div>
    </MotionPresence>
  );
}
