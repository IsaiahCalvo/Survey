// The Survey panel's Report button (nightly 'survey-report'): one button that
// opens a short menu of formats. The report kit picked in the template sets
// what the report holds; this only picks the file type.
import { useEffect, useRef, useState } from 'react';
import Icon from '../Icons';
import Spinner from './Spinner';
import { useTooltip } from './Tooltip';

export const REPORT_FORMATS = Object.freeze([
  { id: 'pptx', label: 'PowerPoint (.pptx)' },
  { id: 'pdf', label: 'PDF (.pdf)' },
  { id: 'xlsx', label: 'Excel with chart (.xlsx)' },
  { id: 'csv', label: 'CSV table (.csv)' },
]);

export default function SurveyReportMenu({ className, phone = false, disabled, busy, hint, onPick }) {
  const tip = useTooltip();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const firstRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    firstRef.current?.focus();
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled || busy}
        onClick={() => setOpen((v) => !v)}
        {...(phone || open ? {} : tip(hint, 'above'))}
      >
        {busy
          ? <Spinner size={phone ? 16 : 14} color="var(--text-1)" trackColor="var(--surface-3)" />
          : <Icon name="document" size={phone ? 16 : 14} color="currentColor" />}
        <span>{busy ? 'Making report…' : 'Report'}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Report format"
          style={{
            position: 'absolute', bottom: 'calc(100% + 6px)', right: 0, zIndex: 60, minWidth: 210, padding: 4,
            background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
          }}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const items = [...e.currentTarget.querySelectorAll('[role="menuitem"]')];
            const at = items.indexOf(document.activeElement);
            items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
          }}
        >
          {REPORT_FORMATS.map((f, i) => (
            <button
              key={f.id}
              ref={i === 0 ? firstRef : undefined}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onPick(f.id); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: phone ? '10px 12px' : '7px 10px', border: 0, borderRadius: 6,
                background: 'transparent', color: 'var(--text-1)', font: 'inherit', fontSize: phone ? 15 : 13, cursor: 'pointer',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
