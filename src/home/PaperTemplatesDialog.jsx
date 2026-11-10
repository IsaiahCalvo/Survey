// Home > New > Other templates (Nightly flag 'home-templates'), copied from
// Drawboard PDF's + menu: Notetaking, Grids and graphs, and Music papers,
// each a tile with a small drawing of the real page. Pick one, set the name,
// size, pages and orientation, and the PDF is made in the browser
// (utils/blankPdf.js) and uploaded and opened like a dropped file.
// Notebook paper in one tap (Drawboard: 10 ruled Letter pages) is
// createNotebookPaperFile below.

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
  BLANK_PAGE_SIZES, MAX_BLANK_PAGES, blankPageBox, buildBlankPdf, clampBlankPages, uniqueDocumentName,
} from '../utils/blankPdf.js';
import './paperTemplates.css';
import { NOTEBOOK_PAGES, PAPER_TEMPLATES, TEMPLATE_GROUPS, templateLabel, templatePreviewPaths } from './paperTemplates.js';

const defaultSizeId = () => (isFeatureOn('default-units') && readUnits() === 'metric' ? 'a4' : 'letter');

/** One tap: a 10-page notebook paper PDF named "Notebook paper" (or "… 2"). */
export async function createNotebookPaperFile(existingNames = []) {
  const title = uniqueDocumentName('Notebook paper', existingNames);
  const bytes = await buildBlankPdf({ title, sizeId: defaultSizeId(), pages: NOTEBOOK_PAGES, paper: 'notebook' });
  return new File([bytes], `${title}.pdf`, { type: 'application/pdf' });
}

function TemplatePreview({ id }) {
  const box = blankPageBox('letter');
  const paths = useMemo(() => templatePreviewPaths(id, box), [id, box]);
  return (
    <svg className="paper-template-preview" viewBox={`0 0 ${box.width} ${box.height}`} width="42" height="54" aria-hidden="true">
      {Object.entries(paths).map(([tone, d]) => (
        <path key={tone} d={d} className={`paper-tone paper-tone--${tone}`} strokeWidth={tone === 'rule' ? 0.5 : 0.8} vectorEffect="non-scaling-stroke" fill="none" />
      ))}
    </svg>
  );
}

const ORIENTATIONS = [
  { id: 'portrait', label: 'Portrait' },
  { id: 'landscape', label: 'Landscape' },
];

export default function PaperTemplatesDialog({ existingNames = [], onCreate, onClose }) {
  const phone = isPhoneLayout();
  const [templateId, setTemplateId] = useState('notebook');
  const [name, setName] = useState(() => uniqueDocumentName(templateLabel('notebook'), existingNames));
  const [nameTouched, setNameTouched] = useState(false);
  const [sizeId, setSizeId] = useState(defaultSizeId);
  const [orientation, setOrientation] = useState('portrait');
  const [pages, setPages] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = (id) => {
    setTemplateId(id);
    if (!nameTouched) setName(uniqueDocumentName(templateLabel(id), existingNames));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const title = uniqueDocumentName(String(name).trim().replace(/\.pdf$/i, ''), existingNames);
    setBusy(true);
    setError('');
    try {
      const bytes = await buildBlankPdf({ title, sizeId, orientation, pages: clampBlankPages(pages), paper: templateId });
      await onCreate(new File([bytes], `${title}.pdf`, { type: 'application/pdf' }));
      onClose();
    } catch (err) {
      console.error('[PaperTemplatesDialog] could not make the document', err);
      setError('Could not make the document. Try again.');
      setBusy(false);
    }
  };

  const sizeOptions = BLANK_PAGE_SIZES.map((s) => ({ value: s.id, label: s.label }));

  return (
    <BodyPortal>
      <DialogCard
        as="form"
        title="New from template"
        onClose={onClose}
        busy={busy}
        width={640}
        cardProps={{ onSubmit: submit, 'data-paper-templates-dialog': 'true' }}
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
          <div className="paper-template-groups">
            {TEMPLATE_GROUPS.map((g) => (
              <div key={g.id} role="radiogroup" aria-label={g.label}>
                <span style={DIALOG_LABEL_STYLE}>{g.label}</span>
                <div className="paper-template-tiles">
                  {PAPER_TEMPLATES.filter((t) => t.group === g.id).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={templateId === t.id}
                      data-paper-template={t.id}
                      disabled={busy}
                      className={`paper-template-tile${templateId === t.id ? ' is-picked' : ''}`}
                      onClick={() => pick(t.id)}
                    >
                      <TemplatePreview id={t.id} />
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <label>
            <span style={DIALOG_LABEL_STYLE}>Name</span>
            <input
              className="dialog-prompt-input"
              style={DIALOG_FIELD_STYLE}
              value={name}
              maxLength={120}
              disabled={busy}
              onChange={(e) => { setName(e.target.value); setNameTouched(true); }}
              onFocus={(e) => e.target.select()}
            />
          </label>
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
          <div>
            <span style={DIALOG_LABEL_STYLE} aria-hidden="true">Orientation</span>
            <div role="radiogroup" aria-label="Orientation" style={{ display: 'flex', gap: 6 }}>
              {ORIENTATIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={orientation === o.id}
                  disabled={busy}
                  className={`dialog-touch-pad paper-template-choice${orientation === o.id ? ' is-picked' : ''}`}
                  onClick={() => setOrientation(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {error ? <p role="alert" style={{ margin: 0, color: C.dangerText, fontSize: 12 }}>{error}</p> : null}
        </div>
      </DialogCard>
    </BodyPortal>
  );
}
