import { useEffect, useRef, useState } from 'react';
import AnnotationDropdown from './AnnotationDropdown.jsx';
import './CounterSeriesMenu.css';

export default function CounterSeriesMenu({ api, onClose }) {
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const editingOwner = useRef(null);
  useEffect(() => { setEditing(null); setError(''); }, [api.__ownerToken]);
  const rows = api.counterSeriesList || [];
  const save = (event) => {
    event.preventDefault();
    if (editingOwner.current !== api.__ownerToken) { setEditing(null); return; }
    const trimmed = name.trim();
    if (!trimmed) { setError('Enter a name.'); return; }
    const result = api.onRenameCounterSeries?.(editing, trimmed);
    if (result?.ok === false) { setError(result.reason === 'locked' ? 'Unlock all pins in this count before renaming it.' : 'This count could not be renamed. Check your permission and try again.'); return; }
    setEditing(null); setError('');
  };
  return <div className="counter-series-menu" data-counter-caret-popup="true" aria-label="Counts">
    {error && !editing && <p role="alert">{error}</p>}
    {rows.length === 0 && <p className="counter-series-menu__empty">Place a pin to start this count.</p>}
    {rows.map(series => <div className="counter-series-menu__row" key={series.seriesId}>
      {editing === series.seriesId ? <form onSubmit={save} className="counter-series-menu__rename">
        <input autoFocus aria-label="Count name" maxLength={80} value={name} onChange={event => { setName(event.target.value); setError(''); }} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(null); }
        }} />
        <div className="counter-series-menu__actions"><button type="submit">Save</button><button type="button" onClick={() => setEditing(null)}>Cancel</button></div>
        {error && <p role="alert">{error}</p>}
      </form> : <>
        <button type="button" className={`counter-series-menu__continue${series.seriesId === api.activeCounterSeriesId ? ' is-active' : ''}`} aria-label={`Continue ${series.label}, ${series.count} ${series.count === 1 ? 'pin' : 'pins'}`} onClick={() => {
          api.onSwitchCounterSeries?.(series.seriesId); api.setActiveTool?.('counter'); onClose?.();
        }}><span>{series.label}</span><small>Continue · {series.count} {series.count === 1 ? 'pin' : 'pins'}</small></button>
        <div className="counter-series-menu__actions">
          <button type="button" aria-label={`Rename ${series.label}`} onClick={() => { editingOwner.current = api.__ownerToken; setEditing(series.seriesId); setName(series.label); setError(''); }}>Rename</button>
          <button type="button" className="counter-series-menu__delete" aria-label={`Delete ${series.label}`} onClick={() => { const result = api.onDeleteCounterSeries?.(series.seriesId); if (result?.ok === false) { setError('This count could not be deleted. Unlock its pins and check your permission.'); return; } onClose?.(); }}>Delete</button>
        </div>
      </>}
    </div>)}
    <button type="button" className="counter-series-menu__new" aria-label="New count" onClick={() => { api.onNewCounterSeries?.(); api.setActiveTool?.('counter'); onClose?.(); }}>New</button>
  </div>;
}

export function CounterSeriesPicker({ api, width }) {
  const [open, setOpen] = useState(false);
  const rows = api.counterSeriesList || [];
  useEffect(() => setOpen(false), [api.__ownerToken]);
  const label = rows.find(series => series.seriesId === api.activeCounterSeriesId)?.label || `Count ${rows.length + 1}`;
  return <AnnotationDropdown open={open} onOpenChange={setOpen} label="Counter series" triggerContent={label} width={width} contentWidth="min(300px, calc(100vw - 24px))" dataMarker="data-counter-series-menu" className="counter-series-picker--mobile">
    {open && <CounterSeriesMenu api={api} onClose={() => setOpen(false)} />}
  </AnnotationDropdown>;
}
