import { useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { COLORS } from '../theme';
export default function SurveyTemplateVersionDialog({ latest, onChoose, onCancel }) {
  const ref = useRef(null); useFocusTrap(ref, true, { onEscape: onCancel });
  return <div style={{ position: 'fixed', inset: 0, zIndex: 10003, background: COLORS.modal.overlay, backdropFilter: 'blur(8px)', display: 'grid', placeItems: 'center' }} onClick={onCancel}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Survey template updated" style={{ width: 440, maxWidth: '90vw', padding: 24, border: `1px solid ${COLORS.modal.border}`, background: COLORS.modal.surface, color: COLORS.modal.textPrimary, borderRadius: 8 }} onClick={(event) => event.stopPropagation()}>
      <h3 style={{ marginTop: 0 }}>Survey template updated</h3>
      <p style={{ fontSize: 14, lineHeight: 1.5 }}>{latest.name} has changed since you used it in this document. Keep the version used here, or use the latest template. Your Survey Markers and answers stay saved.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <button type="button" className="btn btn-default" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-default" onClick={() => onChoose(false)}>Keep previous version</button>
        <button type="button" className="btn btn-primary" onClick={() => onChoose(true)}>Use latest version</button>
      </div>
    </div>
  </div>;
}
