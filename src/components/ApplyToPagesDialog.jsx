import { useState } from 'react';
import DialogCard, { DIALOG_FIELD_STYLE, DIALOG_LABEL_STYLE } from './DialogCard.jsx';
import { applyToPagesTargets } from '../utils/applyToPages.js';

// Apply to pages (Nightly 'apply-to-pages', KAL-720, Drawboard's More menu):
// where the copies go. All pages, or the pages typed (2-5, 8); the page the
// marks came from is skipped. Enter applies.
export default function ApplyToPagesDialog({ pageCount = 0, sourcePage = null, markCount = 1, onApply, onCancel }) {
  const [mode, setMode] = useState('all');
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const target = applyToPagesTargets({ mode, text, pageCount, sourcePage });
  const showError = target.error && (tried || mode === 'all');
  const submit = (event) => {
    event?.preventDefault?.();
    setTried(true);
    if (!target.error) onApply?.(target.pages);
  };
  const what = markCount === 1 ? 'this mark' : `these ${markCount} marks`;
  return (
    <DialogCard
      title="Apply to pages"
      message={`A copy of ${what} goes in the same spot on each page.`}
      onClose={onCancel}
      width={380}
      as="form"
      cardProps={{ onSubmit: submit, onKeyDown: (e) => e.stopPropagation(), 'data-apply-to-pages-dialog': 'true' }}
      footer={(
        <>
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onCancel}>Cancel</button>
          <button
            type="submit"
            className="hub-btn hub-btn--primary dialog-touch-pad"
            data-apply-to-pages-apply="true"
            disabled={Boolean(target.error) && (tried || mode === 'all')}
          >
            {target.error ? 'Apply' : `Apply to ${target.pages.length === 1 ? '1 page' : `${target.pages.length} pages`}`}
          </button>
        </>
      )}
    >
      <div className="chrome-segmented" role="group" aria-label="Which pages" style={{ width: '100%', marginBottom: 12 }}>
        {[['all', 'All pages'], ['pages', 'Pages']].map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            data-apply-to-pages-mode={id}
            onClick={() => { setMode(id); setTried(false); }}
            style={{ flex: 1 }}
          >
            <span>{label}</span>
          </button>
        ))}
      </div>
      {mode === 'pages' && (
        <label style={{ display: 'block' }}>
          <span style={DIALOG_LABEL_STYLE}>Pages, such as 2-5, 8</span>
          <input
            autoFocus
            className="dialog-prompt-input"
            type="text"
            inputMode="numeric"
            aria-label="Pages"
            data-apply-to-pages-field="true"
            value={text}
            placeholder={pageCount > 1 ? `1-${pageCount}` : '1'}
            onChange={(e) => { setText(e.target.value); setTried(false); }}
            style={DIALOG_FIELD_STYLE}
          />
        </label>
      )}
      {showError && (
        <div role="alert" data-apply-to-pages-error="true" style={{ marginTop: 8, color: 'var(--danger-text)' }}>
          {target.error}
        </div>
      )}
    </DialogCard>
  );
}
