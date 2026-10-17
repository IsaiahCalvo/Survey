import { useRef, useState } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { COLORS } from '../theme';
export default function SurveyCategoryMoveDialog({ modules, sourceId, count, onMove, onClose }) {
  const [destination, setDestination] = useState('');
  const [error, setError] = useState('');
  const ref = useRef(null); useFocusTrap(ref, true, { onEscape: onClose });
  return <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10002, display: 'grid', placeItems: 'center', background: COLORS.modal.overlay, backdropFilter: 'blur(8px)' }}>
    <form ref={ref} role="dialog" aria-modal="true" aria-label="Move categories" onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); const result = onMove(destination); if (result?.ok) onClose(); else setError(result?.reason || 'Could not move these categories.'); }} style={{ background: COLORS.modal.surface, color: COLORS.modal.textPrimary, border: `1px solid ${COLORS.modal.border}`, borderRadius: 8, width: 380, maxWidth: '90vw', padding: 24 }}>
      <h3 style={{ margin: '0 0 12px' }}>Move {count} {count === 1 ? 'category' : 'categories'}</h3>
      <p style={{ fontSize: 13, color: COLORS.modal.textMuted }}>The categories and their Survey Markers move together. Their answers and page locations stay the same.</p>
      <label style={{ display: 'grid', gap: 8, fontSize: 13 }}>Destination module<select aria-label="Destination module" value={destination} onChange={(event) => { setDestination(event.target.value); setError(''); }} style={{ background: COLORS.modal.panel, color: COLORS.modal.textPrimary, padding: 10, border: `1px solid ${COLORS.modal.borderStrong}`, borderRadius: 6 }}>
        <option value="">Choose a module</option>{modules.filter((entry) => entry.id !== sourceId).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select></label>
      {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}><button type="button" className="btn btn-default" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={!destination}>Move</button></div>
    </form>
  </div>;
}
