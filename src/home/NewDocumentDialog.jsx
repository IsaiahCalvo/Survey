// src/home/NewDocumentDialog.jsx
//
// Home > New > Blank document (Nightly flag 'new-document', Drawboard PDF Pro
// trial audit 2026-11-09). Name, page size, orientation, pages and paper,
// with a small live page sketch so the whole form fits on a phone. The PDF is
// made in the browser (utils/blankPdf.js) and goes through the same upload
// as a dropped file, then opens.

import { useMemo, useState } from 'react';
import BodyPortal from '../components/BodyPortal';
import DialogCard, { DIALOG_FIELD_STYLE, DIALOG_LABEL_STYLE } from '../components/DialogCard.jsx';
import ValueSelect from '../components/ValueSelect.jsx';
import Spinner from '../components/Spinner';
import { C } from '../uiPalette';
import { isPhoneLayout } from '../utils/layoutMode.js';
import { readUnits } from '../utils/annotationPreferences.js';
import { isFeatureOn } from '../featureFlags.js';
import {
  BLANK_PAGE_SIZES, BLANK_PAPERS, MAX_BLANK_PAGES, blankPageBox, buildBlankPdf, clampBlankPages, uniqueDocumentName,
} from '../utils/blankPdf.js';

const ORIENTATIONS = [
  { id: 'portrait', label: 'Portrait' },
  { id: 'landscape', label: 'Landscape' },
];

const choiceStyle = (on) => ({
  flex: 1, minHeight: 32, padding: '0 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
  border: `1px solid ${on ? C.gold : C.ruleStrong}`, background: on ? C.pressed : 'transparent',
  color: on ? C.ink : C.inkSoft, fontSize: 12, fontWeight: on ? 600 : 500, fontFamily: 'inherit',
});

// The sketch's paper, drawn with CSS so nothing heavy runs per keystroke.
function paperBackground(paper) {
  const ink = 'rgba(120, 150, 190, 0.45)';
  if (paper === 'lined') return { backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 5px, ${ink} 5px 6px)` };
  if (paper === 'grid') {
    return {
      backgroundImage: `linear-gradient(${ink} 1px, transparent 1px), linear-gradient(90deg, ${ink} 1px, transparent 1px)`,
      backgroundSize: '5px 5px',
    };
  }
  if (paper === 'dots') return { backgroundImage: `radial-gradient(${ink} 0.8px, transparent 1px)`, backgroundSize: '5px 5px' };
  return {};
}

function ChoiceRow({ label, options, value, onChange, disabled }) {
  return (
    <div>
      <span style={DIALOG_LABEL_STYLE} aria-hidden="true">{label}</span>
      <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 6 }}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            disabled={disabled}
            className="dialog-touch-pad"
            style={choiceStyle(value === o.id)}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function NewDocumentDialog({ existingNames = [], onCreate, onClose }) {
  const phone = isPhoneLayout();
  const [name, setName] = useState(() => uniqueDocumentName('Blank document', existingNames));
  const [sizeId, setSizeId] = useState(() => (isFeatureOn('default-units') && readUnits() === 'metric' ? 'a4' : 'letter'));
  const [orientation, setOrientation] = useState('portrait');
  const [pages, setPages] = useState('1');
  const [paper, setPaper] = useState('blank');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const box = blankPageBox(sizeId, orientation);
  const sketch = useMemo(() => {
    const tall = 72;
    const scale = tall / Math.max(box.width, box.height);
    return { width: Math.round(box.width * scale), height: Math.round(box.height * scale) };
  }, [box.width, box.height]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const title = uniqueDocumentName(String(name).trim().replace(/\.pdf$/i, ''), existingNames);
    setBusy(true);
    setError('');
    try {
      const bytes = await buildBlankPdf({ title, sizeId, orientation, pages: clampBlankPages(pages), paper });
      const file = new File([bytes], `${title}.pdf`, { type: 'application/pdf' });
      await onCreate(file);
      onClose();
    } catch (err) {
      console.error('[NewDocumentDialog] could not make the document', err);
      setError('Could not make the document. Try again.');
      setBusy(false);
    }
  };

  const sizeOptions = BLANK_PAGE_SIZES.map((s) => ({ value: s.id, label: s.label }));

  return (
    <BodyPortal>
      <DialogCard
        as="form"
        title="New blank document"
        onClose={onClose}
        busy={busy}
        width={400}
        cardProps={{ onSubmit: submit, 'data-new-document-dialog': 'true' }}
        footer={(
          <>
            <button type="button" className="hub-btn dialog-touch-pad" disabled={busy} onClick={onClose}>Cancel</button>
            <button type="submit" className="hub-btn hub-btn--primary dialog-touch-pad" disabled={busy || !name.trim()}>
              {busy ? (<><Spinner size={12} color="currentColor" />Creating…</>) : 'Create'}
            </button>
          </>
        )}
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end' }}>
            <label style={{ flex: 1, minWidth: 0 }}>
              <span style={DIALOG_LABEL_STYLE}>Name</span>
              <input
                className="dialog-prompt-input"
                style={DIALOG_FIELD_STYLE}
                value={name}
                maxLength={120}
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <div
              data-new-document-sketch={`${orientation} ${paper}`}
              aria-hidden="true"
              style={{
                flex: 'none', width: sketch.width, height: sketch.height, background: '#fff',
                border: `1px solid ${C.ruleStrong}`, borderRadius: 2, boxSizing: 'border-box',
                ...paperBackground(paper),
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={DIALOG_LABEL_STYLE} aria-hidden="true">Page size</span>
              {phone ? (
                <select
                  aria-label="Page size"
                  className="dialog-prompt-input"
                  style={DIALOG_FIELD_STYLE}
                  value={sizeId}
                  disabled={busy}
                  onChange={(e) => setSizeId(e.target.value)}
                >
                  {sizeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <ValueSelect label="Page size" value={sizeId} options={sizeOptions} disabled={busy} onChange={setSizeId} />
              )}
            </div>
            <label style={{ width: 84, flex: 'none' }}>
              <span style={DIALOG_LABEL_STYLE}>Pages</span>
              <input
                className="dialog-prompt-input"
                style={DIALOG_FIELD_STYLE}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_BLANK_PAGES}
                value={pages}
                disabled={busy}
                onChange={(e) => setPages(e.target.value)}
                onBlur={() => setPages(String(clampBlankPages(pages)))}
              />
            </label>
          </div>
          <ChoiceRow label="Orientation" options={ORIENTATIONS} value={orientation} onChange={setOrientation} disabled={busy} />
          <ChoiceRow label="Paper" options={BLANK_PAPERS} value={paper} onChange={setPaper} disabled={busy} />
          {error ? <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 12 }}>{error}</p> : null}
        </div>
      </DialogCard>
    </BodyPortal>
  );
}
