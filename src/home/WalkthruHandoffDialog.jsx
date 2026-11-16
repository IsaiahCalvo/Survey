/* Add a Walkthru walk to a Project (KAL-594, Nightly flag 'suite').
   Survey and Walkthru share one account and one database, so Survey reads
   the walk itself. The user picks the walk, then the Template and Module
   once. Each Walkthru node with a Category becomes a Survey Marker dot where
   it was dropped. Categories linked through the library match on their own;
   a Category with the exact same name is listed for the user to confirm;
   the rest are counted under "Not in this Module", never dropped.
   Rules: suite/walkthruHandoff.js; work: suite/walkthruHandoffRun.js. */
import { useEffect, useMemo, useRef, useState } from 'react';
import DialogCard from '../components/DialogCard.jsx';
import ValueSelect from '../components/ValueSelect.jsx';
import Spinner from '../components/Spinner';
import { Icon } from './HubShell';
import { Z_INDEX } from '../theme';
import { matchCategories } from '../suite/walkthruHandoff.js';
import '../components/PdfToolsDialog.css';
import '../components/ExportPdfDialog.css';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function modulesOf(template) {
  return template?.modules || template?.spaces || template?.config?.modules || [];
}

function Check({ on, label, onToggle, attr }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} className={`xpdf-page${on ? ' is-on' : ''}`} {...attr} onClick={onToggle}>
      <span className="xpdf-check" aria-hidden="true">{on ? <Icon name="check" size={11} /> : null}</span>
      <span className="xpdf-page__label">{label}</span>
    </button>
  );
}

export function handoffSummary(result) {
  if (!result) return '';
  const parts = [];
  parts.push(result.added || result.updated
    ? [result.added ? `${plural(result.added, 'marker')} added` : '', result.updated ? `${plural(result.updated, 'marker')} updated` : ''].filter(Boolean).join(', ')
    : 'No markers added');
  const missing = (result.notInModule || []).reduce((sum, m) => sum + m.count, 0);
  if (missing) parts.push(`${plural(missing, 'node')} not in this Module`);
  if (result.unplaced) parts.push(`${plural(result.unplaced, 'marker')} with no spot yet`);
  if (result.defaultNodes) parts.push(`${plural(result.defaultNodes, 'node')} with no Category stayed in Walkthru`);
  return `${parts.join('. ')}.`;
}

export default function WalkthruHandoffDialog({
  project, templates = [], supabase, initialWalkId = null,
  listWalks, readWalk, onSend, onClose,
}) {
  const [walks, setWalks] = useState(null);
  const [walkId, setWalkId] = useState(initialWalkId);
  const [walk, setWalk] = useState(null);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? null);
  const template = templates.find((t) => t.id === templateId) || null;
  const [moduleId, setModuleId] = useState(modulesOf(templates[0])[0]?.id ?? null);
  const [confirmed, setConfirmed] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    listWalks(supabase)
      .then((list) => { if (alive.current) setWalks(list); })
      .catch((err) => { if (alive.current) { setWalks([]); setError(err?.message || String(err)); } });
  }, [listWalks, supabase]);

  useEffect(() => {
    setWalk(null);
    setResult(null);
    if (!walkId) return;
    readWalk(supabase, walkId)
      .then((w) => { if (alive.current) setWalk(w); })
      .catch((err) => { if (alive.current) setError(err?.message || String(err)); });
  }, [walkId, readWalk, supabase]);

  useEffect(() => {
    const first = modulesOf(template)[0]?.id ?? null;
    if (!modulesOf(template).some((m) => m.id === moduleId)) setModuleId(first);
  }, [template, moduleId]);

  const usedTypes = useMemo(() => {
    if (!walk) return [];
    const used = new Set(walk.floors.flatMap((f) => f.nodes.map((n) => n.node_type_id)).filter(Boolean));
    return walk.nodeTypes.filter((t) => used.has(t.id));
  }, [walk]);
  const nodeCount = useMemo(() => {
    const counts = new Map();
    for (const f of walk?.floors || []) for (const n of f.nodes) if (n.node_type_id) counts.set(n.node_type_id, (counts.get(n.node_type_id) || 0) + 1);
    return counts;
  }, [walk]);
  const match = useMemo(() => (template && moduleId ? matchCategories(usedTypes, template, moduleId) : null), [usedTypes, template, moduleId]);

  // A name match is confirmed by default; untick to leave it out.
  useEffect(() => {
    if (!match) return;
    setConfirmed(Object.fromEntries(match.nameMatches.map((m) => [m.nodeTypeId, true])));
  }, [match]);

  const categoryFor = useMemo(() => {
    if (!match) return {};
    const out = { ...match.linked };
    for (const m of match.nameMatches) if (confirmed[m.nodeTypeId]) out[m.nodeTypeId] = m.categoryId;
    return out;
  }, [match, confirmed]);

  const send = async () => {
    setError('');
    setBusy(true);
    try {
      const out = await onSend({ walk, template, moduleId, categoryFor });
      if (alive.current) setResult(out);
    } catch (err) {
      if (alive.current) setError(err?.message || String(err));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const walkOptions = (walks || []).map((w) => ({ value: w.id, label: w.name || 'Untitled walk', detail: w.address || undefined }));
  const templateOptions = templates.map((t) => ({ value: t.id, label: t.name || 'Untitled template' }));
  const moduleOptions = modulesOf(template).map((m) => ({ value: m.id, label: m.name || 'Module' }));
  const notIn = (match?.missing || []).map((m) => ({ ...m, count: nodeCount.get(m.nodeTypeId) || 0 }))
    .concat((match?.nameMatches || []).filter((m) => !confirmed[m.nodeTypeId]).map((m) => ({ ...m, count: nodeCount.get(m.nodeTypeId) || 0 })));
  const ready = Boolean(walk && template && moduleId && !busy);

  return (
    <DialogCard
      title="Add a Walkthru walk"
      message={`Into ${project?.name || 'this Project'}. Each node with a Category becomes a Survey Marker where it was dropped.`}
      onClose={busy ? undefined : onClose}
      width={480}
      zIndex={Z_INDEX.modalOverlay}
      cardProps={{ 'data-walkthru-handoff': '' }}
      footer={result ? (
        <button type="button" data-autofocus="" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={onClose}>Done</button>
      ) : (
        <>
          {busy && <span className="pdft-busy" role="status"><Spinner size={14} color="currentColor" /> Adding the walk…</span>}
          <button type="button" className="hub-btn dialog-touch-pad" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" data-walkthru-handoff-send="" className="hub-btn hub-btn--primary dialog-touch-pad" onClick={send} disabled={!ready}>
            <span>Add walk</span>
          </button>
        </>
      )}
    >
      <div className="xpdf-body">
        {result ? (
          <div className="xpdf-section" data-walkthru-handoff-result="">
            <span className="xpdf-label">Done</span>
            <p style={{ margin: 0 }}>{handoffSummary(result)}</p>
            {(result.notInModule || []).length > 0 && (
              <p style={{ margin: '8px 0 0', color: 'var(--text-2)' }}>
                Not in this Module: {result.notInModule.map((m) => `${m.name || 'Unnamed'} (${m.count})`).join(', ')}.
                Add these Categories to the Module, then add the walk again; nothing is copied twice.
              </p>
            )}
            {(result.skippedFloors || []).length > 0 && (
              <p style={{ margin: '8px 0 0', color: 'var(--text-2)' }}>
                Left out: {result.skippedFloors.map((f) => `${f.name} (${f.reason})`).join(', ')}.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="xpdf-section">
              <span className="xpdf-label">Walk</span>
              {walks === null
                ? <span role="status"><Spinner size={14} color="currentColor" /> Finding your walks…</span>
                : walkOptions.length === 0
                  ? <span>No Walkthru walks on this account yet.</span>
                  : <ValueSelect label="Walk" value={walkId} options={walkOptions} placeholder="Pick a walk" onChange={setWalkId} disabled={busy} />}
            </div>
            <div className="xpdf-section">
              <span className="xpdf-label">Template</span>
              {templateOptions.length === 0
                ? <span>Make a Template first. Its Module sets the Categories and checklists.</span>
                : <ValueSelect label="Template" value={templateId} options={templateOptions} onChange={setTemplateId} disabled={busy} />}
            </div>
            {moduleOptions.length > 0 && (
              <div className="xpdf-section">
                <span className="xpdf-label">Module</span>
                <ValueSelect label="Module" value={moduleId} options={moduleOptions} onChange={setModuleId} disabled={busy} />
              </div>
            )}
            {walk && match && (
              <div className="xpdf-section" data-walkthru-handoff-match="">
                <span className="xpdf-label">Categories</span>
                {usedTypes.length === 0 && <span>This walk has no nodes with a Category.</span>}
                {Object.keys(match.linked).map((typeId) => {
                  const type = usedTypes.find((t) => t.id === typeId);
                  return <div key={typeId}>{type?.name} ({nodeCount.get(typeId) || 0}): linked in the library</div>;
                })}
                {match.nameMatches.map((m) => (
                  <Check
                    key={m.nodeTypeId}
                    on={Boolean(confirmed[m.nodeTypeId])}
                    label={`${m.name} (${nodeCount.get(m.nodeTypeId) || 0}): same name in this Module`}
                    attr={{ 'data-walkthru-name-match': m.nodeTypeId }}
                    onToggle={() => setConfirmed((c) => ({ ...c, [m.nodeTypeId]: !c[m.nodeTypeId] }))}
                  />
                ))}
                {notIn.length > 0 && (
                  <div style={{ marginTop: 6, color: 'var(--text-2)' }} data-walkthru-not-in-module="">
                    Not in this Module: {notIn.map((m) => `${m.name || 'Unnamed'} (${m.count})`).join(', ')}. They are counted, not added.
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {error && <div role="alert" style={{ color: 'var(--danger-text)', marginTop: 8 }}>{error}</div>}
      </div>
    </DialogCard>
  );
}
