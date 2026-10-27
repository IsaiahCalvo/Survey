// src/components/SurveyCategoryMoveDialog.jsx
//
// Survey panel → Select → Move: pick the module the chosen categories move to.
// On DialogCard, the app's one dialog look (owner 2026-10-26), with the hub
// buttons in its footer; Enter submits (the card is a form).

import { useState } from 'react';
import BodyPortal from './BodyPortal';
import DialogCard from './DialogCard.jsx';
import ValueSelect from './ValueSelect.jsx';
import { COLORS, Z_INDEX } from '../theme';

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
          <div style={{ display: 'grid', gap: 6, fontSize: 12, color: COLORS.modal.textMuted }}>
            <span aria-hidden="true">Destination module</span>
            <ValueSelect
              label="Destination module"
              value={destination}
              placeholder="Choose a module"
              options={modules.filter((entry) => entry.id !== sourceId).map((entry) => ({ value: entry.id, label: entry.name }))}
              onChange={(next) => { setDestination(next); setError(''); }}
            />
          </div>
          {error ? <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 13 }}>{error}</p> : null}
        </div>
      </DialogCard>
    </BodyPortal>
  );
}
