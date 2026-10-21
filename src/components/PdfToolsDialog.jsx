/* PDF tools inside the app: merge, split, organize, rotate, compress, OCR,
   flatten and password, run in the browser with the same code as the free
   /tools pages (src/tools/inApp.js). The result is saved as a new document
   next to the original (onSave), opened in a tab (onOpen) or downloaded.

   sources: [{ id, name, getBytes: () => Promise<Uint8Array> }]. The first is
   the document the tools work on; `others` are documents that can be added
   to a merge. Markups made in Survey live beside the PDF, not in it, so the
   tools work on the PDF as it was uploaded. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../home/HubShell';
import { useFocusTrap } from '../hooks/useFocusTrap';
import Spinner from './Spinner';
import MotionPresence from './MotionPresence.jsx';
import { C } from '../uiPalette';
import { IN_APP_TOOLS, runInAppTool } from '../tools/inApp.js';
import { ToolError } from '../tools/errors.js';
import './PdfToolsDialog.css';

const fmtSize = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

function Seg({ label, value, choices, onChange }) {
  return (
    <div className="pdft-field">
      <span className="pdft-label">{label}</span>
      <div className="pdft-seg" role="radiogroup" aria-label={label}>
        {choices.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'is-on' : ''} onClick={() => onChange(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

// Small pictures of each page, for organize and rotate.
function usePageThumbs(getBytes, wanted) {
  const [thumbs, setThumbs] = useState(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setThumbs(null);
    setDone(false);
    setError('');
    if (!wanted) return undefined;
    let dead = false;
    (async () => {
      try {
        const { openPdfjs, renderPage, releaseCanvas } = await import('../tools/browser.js');
        const pdf = await openPdfjs((await getBytes()).slice());
        const list = [];
        for (let i = 0; i < pdf.numPages && !dead; i += 1) {
          const canvas = await renderPage(pdf, i, { width: 120 });
          list.push(canvas.toDataURL('image/jpeg', 0.7));
          releaseCanvas(canvas);
          if (i % 6 === 5 || i === pdf.numPages - 1) setThumbs([...list]);
        }
        (pdf.loadingTask || pdf).destroy?.();
        if (!dead) setDone(true);
      } catch {
        if (!dead) setError('The pages could not be shown. The file may be damaged.');
      }
    })();
    return () => { dead = true; };
  }, [wanted]); // eslint-disable-line react-hooks/exhaustive-deps
  return { thumbs, done, error };
}

function PageGrid({ thumbs, error, order, setOrder, rotateOnly }) {
  if (error) return <p className="pdft-error">{error}</p>;
  if (!thumbs || !order.length) return <p className="pdft-note"><Spinner size={14} color="currentColor" /> Loading pages…</p>;
  const move = (k, d) => setOrder((o) => {
    const n = [...o];
    const j = k + d;
    if (j < 0 || j >= n.length) return o;
    [n[k], n[j]] = [n[j], n[k]];
    return n;
  });
  const turn = (k) => setOrder((o) => o.map((p, i) => (i === k ? { ...p, turns: (p.turns || 0) + 1 } : p)));
  const remove = (k) => setOrder((o) => o.filter((_, i) => i !== k));
  return (
    <ol className="pdft-pages">
      {order.map((p, k) => (
        <li key={`${p.index}-${k}`} className="pdft-page">
          <div className="pdft-thumb">
            {thumbs[p.index]
              ? <img src={thumbs[p.index]} alt="" style={{ transform: `rotate(${((p.turns || 0) % 4) * 90}deg)` }} />
              : <Spinner size={14} color="currentColor" />}
          </div>
          <span className="pdft-pnum">Page {p.index + 1}</span>
          <div className="pdft-pbtns">
            {!rotateOnly && <button type="button" onClick={() => move(k, -1)} disabled={k === 0} aria-label={`Move page ${p.index + 1} earlier`}>←</button>}
            <button type="button" onClick={() => turn(k)} aria-label={`Turn page ${p.index + 1}`}>↻</button>
            {!rotateOnly && <button type="button" onClick={() => move(k, 1)} disabled={k === order.length - 1} aria-label={`Move page ${p.index + 1} later`}>→</button>}
            {!rotateOnly && <button type="button" onClick={() => remove(k)} disabled={order.length === 1} aria-label={`Remove page ${p.index + 1}`}>✕</button>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function PdfToolsDialog({ open, onClose, sources = [], others = [], initialTool = null, onSave = null, onOpen = null }) {
  const cardRef = useRef(null);
  const [tool, setTool] = useState(initialTool);
  const [opts, setOpts] = useState({});
  const [extra, setExtra] = useState([]); // ids of `others` added to a merge
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const [order, setOrder] = useState([]);

  useFocusTrap(cardRef, open, { onEscape: busy ? undefined : onClose });

  const main = sources[0];
  // Fetched once per open and shared by the page grid and the run.
  const bytesRef = useRef(new Map());
  const bytesOf = useMemo(() => (src) => {
    if (!bytesRef.current.has(src.id)) {
      const pending = Promise.resolve(src.getBytes()).then((b) => (b instanceof Uint8Array ? b : new Uint8Array(b)));
      // Forget a failed download so the next Run tries again.
      pending.catch(() => bytesRef.current.delete(src.id));
      bytesRef.current.set(src.id, pending);
    }
    return bytesRef.current.get(src.id);
  }, []);
  const mainRef = useRef(main);
  mainRef.current = main;
  const getMainBytes = useMemo(() => () => bytesOf(mainRef.current), [bytesOf]);

  useEffect(() => {
    if (!open) return;
    bytesRef.current = new Map();
    setTool(initialTool);
    setOpts({});
    setExtra([]);
    setBusy('');
    setError('');
    setResult(null);
    setSaved(false);
  }, [open, initialTool]);

  const wantsPages = tool === 'organize' || tool === 'rotate';
  const { thumbs, done: thumbsDone, error: thumbError } = usePageThumbs(getMainBytes, open && wantsPages && main ? main.id : null);
  // A fresh page list for each tool, once every page has its picture.
  useEffect(() => {
    setOrder(thumbsDone && thumbs ? thumbs.map((_, index) => ({ index, turns: 0 })) : []);
  }, [tool, thumbsDone]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !main) return <MotionPresence open={false} />;

  const set = (k, v) => setOpts((o) => ({ ...o, [k]: v }));
  const mergeList = [main, ...others.filter((o) => extra.includes(o.id))];
  const def = IN_APP_TOOLS.find((t) => t.id === tool);
  const toolList = IN_APP_TOOLS.filter((t) => t.id !== 'merge' || sources.length > 1 || others.length > 0);
  const canSaveHere = Boolean(onSave) && tool !== 'protect';

  const run = async () => {
    setError('');
    setBusy('Getting the document…');
    try {
      const list = tool === 'merge' ? (sources.length > 1 ? sources : mergeList) : [main];
      const withBytes = [];
      for (const s of list) withBytes.push({ name: s.name, bytes: await bytesOf(s) });
      let o = opts;
      if (tool === 'organize') o = { order };
      if (tool === 'rotate') o = { turns: Object.fromEntries(order.map((p) => [p.index, p.turns || 0])) };
      if (tool === 'split') o = { mode: 'ranges', ...opts, ranges: opts.ranges ?? '' };
      const files = await runInAppTool(tool, withBytes, o, (m) => setBusy(m));
      setResult(files);
    } catch (err) {
      console.error('[PdfTools] run failed', err);
      setError(err instanceof ToolError ? err.message : 'Something went wrong. The file may be damaged or locked. Try again.');
    } finally {
      setBusy('');
    }
  };

  const asFiles = () => result.map((r) => new File([r.bytes], r.name, { type: 'application/pdf' }));
  const save = async () => {
    setBusy('Saving…');
    try {
      await onSave(asFiles());
      setSaved(true);
    } catch (err) {
      setError(err?.message || 'Saving failed. Try again.');
    } finally {
      setBusy('');
    }
  };
  const download = async () => {
    const { saveFile } = await import('../tools/browser.js');
    result.forEach((r) => saveFile(r.bytes, r.name, 'application/pdf'));
  };

  const options = () => {
    switch (tool) {
      case 'merge':
        if (sources.length > 1) return <p className="pdft-note">{sources.length} documents will be joined in the order they are listed.</p>;
        return (
          <fieldset className="pdft-field pdft-pick">
            <legend className="pdft-label">Add documents after “{main.name}”</legend>
            {others.map((o) => (
              <label key={o.id} className="pdft-check">
                <input type="checkbox" checked={extra.includes(o.id)} onChange={(e) => setExtra((x) => (e.target.checked ? [...x, o.id] : x.filter((id) => id !== o.id)))} />
                <span>{o.name}</span>
              </label>
            ))}
          </fieldset>
        );
      case 'split':
        return (
          <>
            <Seg label="Split" value={opts.mode || 'ranges'} choices={[['ranges', 'By ranges'], ['every', 'Every few pages'], ['each', 'Every page']]} onChange={(v) => set('mode', v)} />
            {(opts.mode || 'ranges') === 'ranges' && (
              <label className="pdft-field"><span className="pdft-label">Ranges</span>
                <input className="pdft-input" value={opts.ranges ?? ''} placeholder="1-3, 4-10" onChange={(e) => set('ranges', e.target.value)} />
                <span className="pdft-help">Each range becomes its own document.</span>
              </label>
            )}
            {opts.mode === 'every' && (
              <label className="pdft-field"><span className="pdft-label">Pages per document</span>
                <input className="pdft-input" type="number" min="1" value={opts.every ?? '2'} onChange={(e) => set('every', e.target.value)} />
              </label>
            )}
          </>
        );
      case 'organize':
      case 'rotate':
        return (
          <>
            {tool === 'rotate' && order.length > 0 && <button type="button" className="hub-btn pdft-all" onClick={() => setOrder((o) => o.map((p) => ({ ...p, turns: (p.turns || 0) + 1 })))}>Turn every page</button>}
            <PageGrid thumbs={thumbs} error={thumbError} order={order} setOrder={setOrder} rotateOnly={tool === 'rotate'} />
          </>
        );
      case 'compress':
        return <Seg label="How much" value={opts.level || 'medium'} choices={[['light', 'Light'], ['medium', 'Medium'], ['strong', 'Strong']]} onChange={(v) => set('level', v)} />;
      case 'ocr':
        return (
          <>
            <label className="pdft-check"><input type="checkbox" checked={opts.skipText !== false} onChange={(e) => set('skipText', e.target.checked)} /><span>Skip pages that already have text</span></label>
            <p className="pdft-help">English only. Reading takes a few seconds a page; keep this open until it finishes.</p>
          </>
        );
      case 'flatten':
        return <p className="pdft-note">Filled-in form fields and PDF comments become part of the page and can no longer be changed.</p>;
      case 'protect':
        return (
          <>
            <label className="pdft-field"><span className="pdft-label">Password</span><input className="pdft-input" type="password" autoComplete="new-password" value={opts.password || ''} onChange={(e) => set('password', e.target.value)} /></label>
            <label className="pdft-field"><span className="pdft-label">Type it again</span><input className="pdft-input" type="password" autoComplete="new-password" value={opts.again || ''} onChange={(e) => set('again', e.target.value)} /></label>
            <p className="pdft-help">The locked copy downloads to this device. Survey can't show locked documents, so it isn't added to the project.</p>
          </>
        );
      default:
        return null;
    }
  };

  const resultView = () => {
    const total = result.reduce((n, r) => n + r.bytes.length, 0);
    const before = result[0]?.before;
    return (
      <div className="pdft-result" role="status">
        <p className="pdft-big">{saved ? (result.length > 1 ? `Saved ${result.length} new documents` : 'Saved as a new document') : (result.length > 1 ? `${result.length} documents ready` : 'Your document is ready')}</p>
        {before ? <p className="pdft-note">{fmtSize(before)} → {fmtSize(total)}{before > total ? ` (${Math.round((1 - total / before) * 100)}% smaller)` : ' (already about as small as it gets)'}</p> : null}
        {result[0]?.note && <p className="pdft-note">{result[0].note}</p>}
        <ul className="pdft-names">{result.map((r) => <li key={r.name}>{r.name} <span>· {fmtSize(r.bytes.length)}</span></li>)}</ul>
      </div>
    );
  };

  const title = def ? def.label : 'PDF tools';
  return (
    <MotionPresence open>
      <div className="pdft-overlay" style={{ background: C.scrim }} onClick={busy ? undefined : onClose}>
        <div ref={cardRef} role="dialog" aria-modal="true" aria-label={title} className="pdft-card" onClick={(e) => e.stopPropagation()}>
          <div className="pdft-head">
            {tool && !result && !initialTool && <button type="button" className="hub-icon-btn dialog-touch-pad" aria-label="Back to all tools" onClick={() => { setTool(null); setError(''); }} disabled={Boolean(busy)}>←</button>}
            <div className="pdft-title">
              <div className="pdft-h">{title}</div>
              <div className="pdft-sub">{tool === 'merge' && sources.length > 1 ? `${sources.length} documents` : main.name}</div>
            </div>
            <button type="button" className="hub-icon-btn dialog-touch-pad" aria-label="Close" onClick={onClose} disabled={Boolean(busy)}><Icon name="close" size={13} /></button>
          </div>
          <div className="pdft-body">
            {!tool && (
              <>
                <ul className="pdft-tools">
                  {toolList.map((t) => (
                    <li key={t.id}><button type="button" className="pdft-tool" onClick={() => setTool(t.id)}><span className="pdft-tname">{t.label}</span><span className="pdft-tshort">{t.short}</span></button></li>
                  ))}
                </ul>
                <p className="pdft-help">Runs on this device. The tools use the PDF as it was uploaded; markups you added in Survey aren't included.</p>
              </>
            )}
            {tool && !result && options()}
            {result && resultView()}
            {error && <p className="pdft-error" role="alert">{error}</p>}
          </div>
          {tool && (
            <div className="pdft-foot">
              {busy && <span className="pdft-busy" role="status"><Spinner size={14} color="currentColor" /> {busy}</span>}
              {!result && <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" disabled={Boolean(busy) || (wantsPages && !order.length) || (tool === 'merge' && mergeList.length < 2 && sources.length < 2)} onClick={run}>{def?.id === 'protect' ? 'Lock a copy' : 'Run'}</button>}
              {result && !saved && (
                <>
                  <button type="button" className="hub-btn dialog-touch-pad" disabled={Boolean(busy)} onClick={download}>Download</button>
                  {canSaveHere && <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" disabled={Boolean(busy)} onClick={save}>{result.length > 1 ? 'Save as new documents' : 'Save as new document'}</button>}
                  {!canSaveHere && onOpen && tool !== 'protect' && <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={() => { asFiles().forEach(onOpen); onClose(); }}>Open</button>}
                </>
              )}
              {result && saved && <button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={onClose}>Done</button>}
            </div>
          )}
        </div>
      </div>
    </MotionPresence>
  );
}
