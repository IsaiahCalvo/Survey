import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import AnnotationDropdown from './AnnotationDropdown.jsx';
import Icon from '../Icons.jsx';
import { useTooltip } from './Tooltip.jsx';
import { isFeatureOn } from '../featureFlags.js';
import { SortableRearrangeList, SortableRearrangeRow } from '../reorder/SortableRearrangeList.jsx';
import DragRearrangeHandle from '../reorder/DragRearrangeHandle.jsx';
import { moveItem } from '../reorder/flatReorderUtils.js';
import './CounterSeriesMenu.css';

const CompactColorPicker = lazy(() => import('./CompactColorPicker.jsx'));

const pinsLabel = (count) => `${count} ${count === 1 ? 'pin' : 'pins'}`;
const RENAME_ERROR = {
  locked: 'Unlock all pins in this count before renaming it.',
  default: 'This count could not be renamed. Check your permission and try again.',
};
const EDIT_ERROR = {
  locked: 'Unlock all pins in this count before changing it.',
  default: 'This count could not be changed. Check your permission and try again.',
};

// The counts list under the counter tool's series pill (and the phone's).
// Survey Nightly shows the new list (beta 'counter-list'); stable keeps the
// first version until the flag graduates.
export default function CounterSeriesMenu(props) {
  const [listOn] = useState(() => isFeatureOn('counter-list'));
  return listOn ? <CounterSeriesList {...props} /> : <ClassicCounterSeriesMenu {...props} />;
}

/**
 * The counts list (beta 'counter-list', owner 2026-10-26: "it doesn't even
 * look like it's integrated with the app"). One row per count, in the app's
 * own list grammar (the Spaces and Templates lists):
 *   [grip] [pin] Name ........ 12 pins [rename] [delete]
 * - Press the name to continue that count (the counter tool arms on it).
 * - The pin is the count's own pin, drawn in its pin colour with a number in
 *   its number colour. Press it to fold the shared colour picker open under
 *   the row, with Pin / Number tabs.
 * - The pencil renames in place: Enter or a press away keeps it, Escape drops it.
 * - The grip drags the count to a new place (also Space + arrows).
 * - "New count" at the foot starts the next one.
 */
function CounterSeriesList({ api, onClose }) {
  const tip = useTooltip();
  const liveRows = api.counterSeriesList || [];
  const [renaming, setRenaming] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [colorRow, setColorRow] = useState(null); // { seriesId, layer: 'fill' | 'number' }
  const [draftPaint, setDraftPaint] = useState(null); // { seriesId, fill?, numberColor? } while a slider drags
  // A dropped row stays where it was dropped until the document catches up.
  const [optimisticIds, setOptimisticIds] = useState(null);
  const renameOwner = useRef(null);

  useEffect(() => {
    setRenaming(null);
    setColorRow(null);
    setError('');
    setOptimisticIds(null);
  }, [api.__ownerToken]);

  const liveKey = liveRows.map((row) => row.seriesId).join('\n');
  useEffect(() => { setOptimisticIds(null); }, [liveKey]);

  const rows = useMemo(() => {
    if (!optimisticIds) return liveRows;
    const byId = new Map(liveRows.map((row) => [row.seriesId, row]));
    const ordered = optimisticIds.map((id) => byId.get(id)).filter(Boolean);
    return ordered.length === liveRows.length ? ordered : liveRows;
  }, [liveRows, optimisticIds]);

  const continueSeries = (seriesId) => {
    api.onSwitchCounterSeries?.(seriesId);
    api.setActiveTool?.('counter');
    onClose?.();
  };

  const startRename = (series) => {
    renameOwner.current = api.__ownerToken;
    setColorRow(null);
    setRenaming(series.seriesId);
    setName(series.label);
    setError('');
  };
  const saveRename = () => {
    if (!renaming) return;
    if (renameOwner.current !== api.__ownerToken) { setRenaming(null); return; }
    const current = rows.find((row) => row.seriesId === renaming);
    const trimmed = name.trim();
    if (!trimmed || trimmed === current?.label) { setRenaming(null); setError(''); return; }
    const result = api.onRenameCounterSeries?.(renaming, trimmed);
    if (result?.ok === false) { setError(RENAME_ERROR[result.reason] || RENAME_ERROR.default); return; }
    setRenaming(null);
    setError('');
  };

  const removeSeries = (series) => {
    const result = api.onDeleteCounterSeries?.(series.seriesId);
    if (result?.ok === false) { setError('This count could not be deleted. Unlock its pins and check your permission.'); return; }
    // The shared confirm opens over the page.
    onClose?.();
  };

  // A slider drag previews in the row and writes once, on release, so one
  // drag is one undo step.
  const applyPaint = (series, layer, hex, meta) => {
    const key = layer === 'number' ? 'numberColor' : 'fill';
    if (meta?.phase === 'preview') {
      setDraftPaint({ seriesId: series.seriesId, [key]: hex });
      return;
    }
    setDraftPaint(null);
    if ((layer === 'number' ? series.numberColor : series.color) === hex) return;
    const result = api.onRecolorCounterSeries?.(series.seriesId, { [key]: hex });
    if (result?.ok === false) setError(EDIT_ERROR[result.reason] || EDIT_ERROR.default);
    else setError('');
  };

  const reorder = (activeId, overId) => {
    const ids = rows.map((row) => row.seriesId);
    const from = ids.indexOf(activeId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return;
    const next = moveItem(ids, from, to);
    setOptimisticIds(next);
    const result = api.onReorderCounterSeries?.(next);
    if (result?.ok === false) {
      setOptimisticIds(null);
      setError(EDIT_ERROR[result.reason] || EDIT_ERROR.default);
    }
  };

  const canReorder = typeof api.onReorderCounterSeries === 'function' && rows.length > 1;

  return <div className="counter-list" data-counter-caret-popup="true" data-counter-list="true" aria-label="Counts">
    {error && <p className="counter-list__error" role="alert">{error}</p>}
    {rows.length === 0
      ? <p className="counter-list__empty">Place a pin to start this count.</p>
      : <div className="counter-list__rows">
        <SortableRearrangeList ids={rows.map((row) => row.seriesId)} onReorder={reorder} gap={0}>
          {rows.map((series) => {
            const active = series.seriesId === api.activeCounterSeriesId;
            const draft = draftPaint?.seriesId === series.seriesId ? draftPaint : null;
            const fill = draft?.fill || series.color;
            const numberColor = draft?.numberColor || series.numberColor || '#ffffff';
            const colorOpen = colorRow?.seriesId === series.seriesId;
            const layer = colorOpen ? colorRow.layer : 'fill';
            return <SortableRearrangeRow key={series.seriesId} id={series.seriesId} disabled={!canReorder || renaming === series.seriesId}>
              {({ attributes, listeners, isDragging }) => <div
                className={`counter-list__item${active ? ' is-active' : ''}${colorOpen ? ' is-open' : ''}`}
                data-counter-series-row={series.seriesId}
              >
                <div className="counter-list__row">
                  {canReorder
                    ? <DragRearrangeHandle
                      {...attributes}
                      {...listeners}
                      isDragging={isDragging}
                      title="Drag to reorder"
                      aria-label={`Reorder ${series.label}`}
                      className="counter-list__grip"
                    />
                    : <span className="counter-list__grip-space" aria-hidden="true" />}
                  <button
                    type="button"
                    className="counter-list__pin"
                    aria-label={`Colours of ${series.label}`}
                    aria-expanded={colorOpen}
                    data-counter-color-trigger="true"
                    data-drag-keep-fill=""
                    {...tip('Pin and number colour', 'below')}
                    onClick={() => {
                      setRenaming(null);
                      setColorRow(colorOpen ? null : { seriesId: series.seriesId, layer: 'fill' });
                    }}
                    style={{ '--counter-pin-fill': fill, '--counter-pin-number': numberColor }}
                  >
                    <span aria-hidden="true">1</span>
                  </button>
                  {renaming === series.seriesId
                    ? <input
                      className="counter-list__name-input"
                      autoFocus
                      aria-label="Count name"
                      maxLength={80}
                      value={name}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => { setName(event.target.value); setError(''); }}
                      onBlur={saveRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') { event.preventDefault(); saveRename(); }
                        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenaming(null); setError(''); }
                      }}
                    />
                    : <button
                      type="button"
                      className="counter-list__name"
                      aria-current={active ? 'true' : undefined}
                      aria-label={`Continue ${series.label}, ${pinsLabel(series.count)}`}
                      onClick={() => continueSeries(series.seriesId)}
                      onDoubleClick={() => startRename(series)}
                    >
                      <span className="counter-list__label">{series.label}</span>
                      <span className="counter-list__count">{pinsLabel(series.count)}</span>
                    </button>}
                  <button
                    type="button"
                    className="counter-list__icon"
                    aria-label={`Rename ${series.label}`}
                    {...tip('Rename', 'below')}
                    onMouseDown={(event) => { if (renaming === series.seriesId) event.preventDefault(); }}
                    onClick={() => (renaming === series.seriesId ? saveRename() : startRename(series))}
                  >
                    <Icon name={renaming === series.seriesId ? 'check' : 'edit'} size={14} color="currentColor" />
                  </button>
                  <button
                    type="button"
                    className="counter-list__icon is-danger"
                    aria-label={`Delete ${series.label}`}
                    {...tip('Delete count', 'below')}
                    onClick={() => removeSeries(series)}
                  >
                    <Icon name="trash" size={14} color="currentColor" />
                  </button>
                </div>
                {colorOpen && <div className="counter-list__colors" data-counter-color-panel="true">
                  <Suspense fallback={<div className="counter-list__colors-loading" />}>
                    <CompactColorPicker
                      color={layer === 'number' ? numberColor : fill}
                      opacity={1}
                      showOpacity={false}
                      firstPreset="none"
                      chrome={false}
                      dismissInsideSelector="[data-counter-color-panel], [data-counter-color-trigger]"
                      tabs={{
                        items: [{ id: 'fill', label: 'Pin' }, { id: 'number', label: 'Number' }],
                        active: layer,
                        onSelect: (next) => setColorRow({ seriesId: series.seriesId, layer: next }),
                      }}
                      onChange={(hex, _alpha, meta) => applyPaint(series, layer, hex, meta)}
                      onClose={() => setColorRow(null)}
                    />
                  </Suspense>
                </div>}
              </div>}
            </SortableRearrangeRow>;
          })}
        </SortableRearrangeList>
      </div>}
    <button
      type="button"
      className="counter-list__new"
      aria-label="New count"
      onClick={() => { api.onNewCounterSeries?.(); api.setActiveTool?.('counter'); onClose?.(); }}
    >
      <Icon name="plus" size={14} color="currentColor" />
      <span>New count</span>
    </button>
  </div>;
}

function ClassicCounterSeriesMenu({ api, onClose }) {
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
