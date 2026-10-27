// src/components/SurveyCategoryMoveDialog.jsx
//
// Survey panel → Select → Move: pick the module the chosen categories move to.
// On DialogCard, the app's one dialog look (owner 2026-10-26), with the hub
// buttons in its footer; Enter submits (the card is a form).

import { useState } from 'react';
import BodyPortal from './BodyPortal';
import DialogCard from './DialogCard.jsx';
import { COLORS, Z_INDEX } from '../theme';

const selectStyle = {
  background: COLORS.modal.panel,
  color: COLORS.modal.textPrimary,
  padding: '8px 10px',
  border: `1px solid ${COLORS.modal.borderStrong}`,
  borderRadius: 6,
  fontFamily: 'inherit',
  fontSize: 13,
};

export default function SurveyCategoryMoveDialog({ modules, sourceId, count, onMove, onClose }) {
  const [destination, setDestination] = useState('');
  const [error, setError] = useState('');
  const submit = (event) => {
    event.preventDefault();
    const result = onMove(destination);
    if (result?.ok) onClose();
    else setError(result?.reason || 'Could not move these categories.');
  };

  return (
    <BodyPortal>
      <DialogCard
        as="form"
        ariaLabel="Move categories"
        title={`Move ${count} ${count === 1 ? 'category' : 'categories'}`}
        message="The categories and their Survey Markers move together. Their answers and page locations stay the same."
        onClose={onClose}
        zIndex={Z_INDEX.modalOverlay}
        cardProps={{ onSubmit: submit }}
        footer={(
          <>
            <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose}>Cancel</button>
            <button type="submit" className="hub-btn hub-btn--primary dialog-touch-pad" disabled={!destination}>Move</button>
          </>
        )}
      >
        <div style={{ display: 'grid', gap: 14 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: 12, color: COLORS.modal.textMuted }}>
            Destination module
            <select
              aria-label="Destination module"
              value={destination}
              onChange={(event) => { setDestination(event.target.value); setError(''); }}
              style={selectStyle}
            >
              <option value="">Choose a module</option>
              {modules.filter((entry) => entry.id !== sourceId).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          {error ? <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 13 }}>{error}</p> : null}
        </div>
      </DialogCard>
    </BodyPortal>
  );
}
