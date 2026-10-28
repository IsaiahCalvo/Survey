import { useEffect, useState } from 'react';
import DialogCard from './DialogCard.jsx';
import Icon from '../Icons';
import { useTooltip } from './Tooltip';
import { C } from '../uiPalette';

/**
 * "What Survey learned" (Nightly beta, plan 2026-10-27): the names and note
 * wording the Survey agent saved for this project, with a remove button on
 * each. Removing acts at once; Undo puts the last one back.
 */
export default function AgentLearnedDialog({ store, projectId, canEdit = true, onClose }) {
  const tip = useTooltip();
  const [rows, setRows] = useState(() => store.cached(projectId));
  const [state, setState] = useState('loading');
  const [removed, setRemoved] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const off = store.subscribe((id) => { if (id === projectId && live) setRows(store.cached(projectId)); });
    store.list(projectId, { fresh: true })
      .then((list) => { if (live) { setRows(list); setState('ready'); } })
      .catch((err) => { if (live) { setError(err.message); setState('ready'); } });
    return () => { live = false; off(); };
  }, [store, projectId]);

  const remove = async (row) => {
    setError('');
    try {
      await store.remove(projectId, row.id);
      setRemoved(row);
    } catch (err) {
      setError(err.message);
    }
  };
  const undo = async () => {
    const row = removed;
    setRemoved(null);
    try { await store.restore(projectId, row); } catch (err) { setError(err.message); }
  };

  const names = rows.filter((r) => r.kind === 'name');
  const wording = rows.filter((r) => r.kind === 'wording');
  const section = (title, list, empty, render) => (
    <section className="agent-learned__section" aria-label={title}>
      <h3 className="agent-learned__heading">{title}<span className="agent-learned__count">{list.length}</span></h3>
      {list.length ? (
        <ul className="agent-learned__list">
          {list.map((row) => (
            <li key={row.id} className="agent-learned__row">
              <span className="agent-learned__text">{render(row)}</span>
              {canEdit ? (
                <button
                  type="button"
                  className="agent-learned__remove"
                  aria-label={`Remove "${row.heard}"`}
                  {...tip('Remove')}
                  onClick={() => remove(row)}
                >
                  <Icon name="close" size={12} color="currentColor" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="agent-learned__empty">{empty}</p>}
    </section>
  );

  return (
    <DialogCard
      title="What Survey learned"
      message="Names and wording the Survey agent saved for this project. Everyone on the project shares them."
      onClose={onClose}
      width={420}
      zIndex={12000}
      footer={<button type="button" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={onClose}>Done</button>}
    >
      {state === 'loading' && !rows.length ? <p role="status" className="agent-learned__empty">Loading…</p> : null}
      {state !== 'loading' || rows.length ? (
        <>
          {section('Names', names, 'None yet. Say "Whenever I say D101, I mean D-1-01".', (row) => (
            <><strong>{row.heard}</strong> means <strong>{row.means}</strong></>
          ))}
          {section('Wording', wording, 'None yet. Say "Always write not installed, not missing".', (row) => (
            <>Write <strong>{row.means}</strong> for <strong>{row.heard}</strong></>
          ))}
        </>
      ) : null}
      {removed ? (
        <p className="agent-learned__undo" role="status">
          Removed "{removed.heard}".
          <button type="button" className="agent-learned__undo-btn" onClick={undo}>Undo</button>
        </p>
      ) : null}
      {error ? <p role="alert" style={{ margin: '10px 0 0', color: C.dangerText }}>{error}</p> : null}
    </DialogCard>
  );
}
