/* Export PDF with choices (Nightly, flag 'export-modes'; owner 2026-10-26).
   Marks: annotated (editable), flattened (burned in) or plain (none).
   Pages: every page, this page, pages with marks, or a typed list.
   The same card, head and foot as the PDF tools dialog, so it reads as one
   family. The viewer does the work: api.exportPdfWithOptions(choice)
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
    ['all', numPages ? `All ${numPages} pages` : 'All pages'],
    ['current', info?.currentPage ? `This page (${info.currentPage})` : 'This page'],
    ['marked', `Pages with marks${info ? ` (${marked.length})` : ''}`],
    ['custom', 'Choose pages'],
  ];
  const customCheck = pages === 'custom' && custom.trim() && numPages ? parsePageList(custom, numPages) : null;

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
            <div className="pdft-title">
              <div className="pdft-h">Export PDF</div>
              {fileName ? <div className="pdft-sub">{fileName}</div> : null}
            </div>
            <button type="button" className="hub-icon-btn dialog-touch-pad" aria-label="Close" onClick={onClose} disabled={busy}><Icon name="close" size={13} /></button>
          </div>
          <div className="pdft-body">
            <div className="pdft-field">
              <span className="pdft-label" id="export-pdf-marks">Marks</span>
              <ul className="pdft-tools pdft-tools--three" role="radiogroup" aria-labelledby="export-pdf-marks">
                {EXPORT_MARK_MODES.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={mode === m.id}
                      className={`pdft-tool${mode === m.id ? ' is-on' : ''}`}
                      onClick={() => setMode(m.id)}
                    >
                      <span className="pdft-tname">{m.label}</span>
                      <span className="pdft-tshort">{m.short}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div className="pdft-field">
              <span className="pdft-label" id="export-pdf-pages">Pages</span>
              <div className="pdft-seg" role="radiogroup" aria-labelledby="export-pdf-pages">
                {pageChoices.map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={pages === v}
                    className={pages === v ? 'is-on' : ''}
                    disabled={v === 'marked' && info && !marked.length}
                    onClick={() => { setPages(v); setError(''); }}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {pages === 'custom' && (
                <>
                  <input
                    className="pdft-input"
                    aria-label="Pages to export"
                    placeholder={numPages > 3 ? `Like 1-3, ${numPages}` : 'Like 1-2'}
                    value={custom}
                    autoFocus
                    onChange={(e) => { setCustom(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !busy) run(); }}
                  />
                  <p className="pdft-help">
                    {customCheck?.pages ? `${customCheck.pages.length} page${customCheck.pages.length === 1 ? '' : 's'}` : customCheck?.error || 'Pages and ranges, split by commas.'}
                  </p>
                </>
              )}
            </div>
            {error && <p className="pdft-error" role="alert">{error}</p>}
          </div>
          <div className="pdft-foot">
            {busy && <span className="pdft-busy" role="status"><Spinner size={14} color="currentColor" /> Making the PDF…</span>}
            <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={run} disabled={busy || (pages === 'custom' && !customCheck?.pages)}>Export</button>
          </div>
        </div>
      </div>
    </MotionPresence>
  );
}
