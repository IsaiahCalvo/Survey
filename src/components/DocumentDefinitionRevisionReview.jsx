import React, { useEffect, useMemo, useRef, useState } from 'react';
import BodyPortal from './BodyPortal.js';

const CHANGE_PAGE_SIZE = 20;

const itemId = value => value?.semanticId || value?.id || null;
const itemLabel = value => value?.name || value?.label || value?.title || value?.text || '(unnamed)';
const retirementRootKey = value => JSON.stringify([value?.kind || '', value?.id || '']);

const labelEntries = value => {
  const entries = [];
  const add = (kind, item) => {
    const id = itemId(item);
    if (id) entries.push({ key: `${kind}:${id}`, kind, id, label: itemLabel(item) });
  };
  for (const module of value?.surveyDefinition?.modules || []) {
    add('module', module);
    for (const category of module.categories || []) {
      add('category', category);
      for (const check of category.checklist || []) add('checklist item', check);
    }
  }
  for (const entity of value?.entityCatalog?.entities || []) add('entity', entity);
  return entries;
};

const labelChanges = (before, after) => {
  const oldEntries = new Map(labelEntries(before).map(entry => [entry.key, entry]));
  const newEntries = new Map(labelEntries(after).map(entry => [entry.key, entry]));
  return [...new Set([...oldEntries.keys(), ...newEntries.keys()])].map(key => {
    const oldEntry = oldEntries.get(key) || null;
    const newEntry = newEntries.get(key) || null;
    return { key, kind: (newEntry || oldEntry).kind, id: (newEntry || oldEntry).id,
      oldLabel: oldEntry?.label || null, newLabel: newEntry?.label || null };
  }).filter(change => change.oldLabel !== change.newLabel)
    .sort((left, right) => left.key.localeCompare(right.key));
};

function DefinitionLabelChanges({ before, after }) {
  const changes = useMemo(() => labelChanges(before, after), [after, before]);
  const [visible, setVisible] = useState(CHANGE_PAGE_SIZE);
  useEffect(() => setVisible(CHANGE_PAGE_SIZE), [after, before]);
  const shown = changes.slice(0, visible);
  const remaining = changes.length - shown.length;
  return <div data-document-definition-label-changes style={{ marginBottom: 10 }}>
    <strong>Label changes ({changes.length})</strong>
    {changes.length === 0
      ? <p style={{ margin: '6px 0 0', fontSize: 13 }}>No label changes.</p>
      : <ul style={{ margin: '6px 0', paddingLeft: 20, maxHeight: 220, overflow: 'auto', fontSize: 13 }}>
        {shown.map(change => <li key={change.key}>
          <span>{change.kind} <code>{change.id}</code>: </span>
          {change.oldLabel === null
            ? <span>Added “{change.newLabel}”</span>
            : change.newLabel === null
              ? <span>Removed “{change.oldLabel}”</span>
              : <span>“{change.oldLabel}” → “{change.newLabel}”</span>}
        </li>)}
      </ul>}
    {remaining > 0 && <button type="button" onClick={() => setVisible(count => count + CHANGE_PAGE_SIZE)}>
      Show {Math.min(CHANGE_PAGE_SIZE, remaining)} more ({remaining} remaining)
    </button>}
  </div>;
}

const counts = value => {
  const modules = value?.surveyDefinition?.modules || [];
  const categories = modules.reduce((sum, module) => sum + (module.categories?.length || 0), 0);
  const checks = modules.reduce((sum, module) => sum + (module.categories || []).reduce(
    (inner, category) => inner + (category.checklist?.length || 0), 0), 0);
  return { modules: modules.length, categories, checks,
    entities: value?.entityCatalog?.entities?.length || 0 };
};

function Summary({ value, label }) {
  const total = counts(value);
  return <div style={{ padding: 10, border: '1px solid #465164', borderRadius: 8 }}>
    <strong>{label}</strong>
    <div style={{ marginTop: 4, fontSize: 13, color: '#c9d0db' }}>
      {total.modules} modules · {total.categories} categories · {total.checks} checklist items · {' '}
      {total.entities} entities
    </div>
  </div>;
}

export default function DocumentDefinitionRevisionReview({ available = false, review = null,
    historicalReview = null, currentReceipt = null, templates = [], sourcesLoading = false,
    busy = false, error = '', onLoadSources, onRequest, onApply, onCancel,
    onConfirmHistorical, onCancelHistorical, scopeKey = '' }) {
  const [surveyTemplateId, setSurveyTemplateId] = useState('');
  const [entityTemplateId, setEntityTemplateId] = useState('');
  const [discoveryState, setDiscoveryState] = useState(null);
  const [consentedRootKeys, setConsentedRootKeys] = useState(() => new Set());
  const [localReviewState, setLocalReviewState] = useState(null);
  const [requestPending, setRequestPending] = useState(false);
  const requestEpochRef = useRef(0);
  const templateOptions = useMemo(() => templates.map(row => {
    const rawConfig = row?.config && typeof row.config === 'object' ? row.config : null;
    const nextTemplate = rawConfig ? { ...rawConfig,
      entities: rawConfig.entities ?? rawConfig.ballInCourtEntities ?? [],
      id: rawConfig.id || row.id, supabaseId: row.id,
      name: rawConfig.name || row.name || 'Unnamed template' } : row;
    return { template: nextTemplate,
      id: nextTemplate?.supabaseId || nextTemplate?.id,
      name: nextTemplate?.name || 'Unnamed template' };
  }).filter(option => option.id), [templates]);
  const surveyTemplate = templateOptions.find(option => option.id === surveyTemplateId)?.template || null;
  const entityTemplate = templateOptions.find(option => option.id === entityTemplateId)?.template || null;
  const requestFence = JSON.stringify([scopeKey, currentReceipt?.documentId || null,
    currentReceipt?.definitionRevision || null, currentReceipt?.definitionDigest || null,
    surveyTemplateId, entityTemplateId]);
  const liveFenceRef = useRef(requestFence);
  liveFenceRef.current = requestFence;
  useEffect(() => {
    requestEpochRef.current += 1;
    setSurveyTemplateId('');
    setEntityTemplateId('');
    setDiscoveryState(null);
    setConsentedRootKeys(new Set());
    setLocalReviewState(null);
    setRequestPending(false);
  }, [scopeKey, currentReceipt?.documentId,
    currentReceipt?.definitionRevision, currentReceipt?.definitionDigest]);
  useEffect(() => () => { requestEpochRef.current += 1; }, []);

  const resetRequestedUpdate = () => {
    requestEpochRef.current += 1;
    setDiscoveryState(null);
    setConsentedRootKeys(new Set());
    setLocalReviewState(null);
    setRequestPending(false);
  };
  const changeSurveyTemplate = value => {
    resetRequestedUpdate();
    setSurveyTemplateId(value);
  };
  const changeEntityTemplate = value => {
    resetRequestedUpdate();
    setEntityTemplateId(value);
  };
  const requestUpdate = async retiredSemanticRoots => {
    if (typeof onRequest !== 'function') return;
    const epoch = ++requestEpochRef.current;
    const fence = requestFence;
    setRequestPending(true);
    try {
      const result = await onRequest({ version: 2, surveyTemplate, entityTemplate,
        retiredSemanticRoots });
      if (!result || requestEpochRef.current !== epoch || liveFenceRef.current !== fence) return;
      if (result.status === 'retirement-required' && result.version === 2
        && result.documentId === currentReceipt?.documentId
        && result.current?.definitionRevision === currentReceipt?.definitionRevision
        && result.current?.definitionDigest === currentReceipt?.definitionDigest
        && Array.isArray(result.removedRoots) && Array.isArray(result.autoRetainedRoots)) {
        setDiscoveryState({ fence, value: result });
        setConsentedRootKeys(new Set());
        setLocalReviewState(null);
      } else if (result.status === 'reviewed' && result.currentReceipt && result.wire
        && result.currentReceipt.documentId === currentReceipt?.documentId
        && result.currentReceipt.definitionRevision === currentReceipt?.definitionRevision
        && result.currentReceipt.definitionDigest === currentReceipt?.definitionDigest) {
        setDiscoveryState(null);
        setConsentedRootKeys(new Set());
        setLocalReviewState({ fence, value: result });
      }
    } catch { /* the caller owns the safe error shown by this panel */ }
    finally {
      if (requestEpochRef.current === epoch && liveFenceRef.current === fence) setRequestPending(false);
    }
  };
  const discovery = discoveryState?.fence === requestFence ? discoveryState.value : null;
  const localReview = localReviewState?.fence === requestFence ? localReviewState.value : null;
  const activeReview = review || localReview;
  if (historicalReview) {
    const old = historicalReview.historicalReceipt;
    const current = historicalReview.currentReceipt;
    return <BodyPortal><section role="dialog" aria-modal="true"
      data-document-definition-history-review aria-label="Review restored definition labels"
      style={{ position: 'fixed', zIndex: 7650, top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)', width: 'min(640px, calc(100% - 24px))',
        padding: 16, borderRadius: 10, background: '#202631', color: '#f4f6f8',
        border: '1px solid #465164', boxShadow: '0 12px 32px rgba(0,0,0,.38)' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Review labels before restoring</h2>
      <p style={{ margin: '0 0 10px', fontSize: 14 }}>
        This saved content came from definition revision {old.definitionRevision}. The shared document now uses
        revision {current.definitionRevision}. Restored marks keep their stable IDs and will use the current shared labels.
      </p>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr', marginBottom: 10 }}>
        <Summary label={`Saved revision ${old.definitionRevision}`} value={old} />
        <Summary label={`Current revision ${current.definitionRevision}`} value={current} />
      </div>
      <DefinitionLabelChanges before={old} after={current} />
      <p style={{ margin: '0 0 10px', fontSize: 12, color: '#aeb7c5' }}>
        Saved proof {old.definitionDigest}. The old values remain available in this review; this action does not change
        the shared definition.
      </p>
      {error && <p role="alert" style={{ color: '#ffb3b3' }}>{error}</p>}
      <button type="button" disabled={busy} onClick={() => { void onConfirmHistorical?.(); }}>Restore with current labels</button>
      <button type="button" disabled={busy} onClick={onCancelHistorical} style={{ marginLeft: 8 }}>Cancel restore</button>
    </section></BodyPortal>;
  }

  if (discovery && !activeReview) {
    const requiredRoots = discovery.removedRoots;
    const allChecked = requiredRoots.every(root => consentedRootKeys.has(retirementRootKey(root)));
    return <BodyPortal><section role="dialog" aria-modal="true"
      data-document-definition-retirement-review aria-label="Review retired document items"
      style={{ position: 'fixed', zIndex: 7650, top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)', width: 'min(640px, calc(100% - 24px))',
        padding: 16, borderRadius: 10, background: '#202631', color: '#f4f6f8',
        border: '1px solid #465164', boxShadow: '0 12px 32px rgba(0,0,0,.38)' }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Confirm retired items</h2>
      <p style={{ margin: '0 0 10px', fontSize: 14 }}>
        These items are not in the chosen source. Check every root to retire it and its listed group.
        Existing marks keep their saved labels.
      </p>
      <fieldset style={{ display: 'grid', gap: 8, margin: '0 0 10px', padding: 10,
        border: '1px solid #465164', borderRadius: 8 }}>
        <legend>Required retirement consent</legend>
        {requiredRoots.map(root => {
          const key = retirementRootKey(root);
          const subtreeCount = Array.isArray(root.subtree) ? root.subtree.length : 1;
          return <label key={key} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr',
            columnGap: 8, alignItems: 'start' }}>
            <input type="checkbox" checked={consentedRootKeys.has(key)} disabled={busy || requestPending}
              onChange={event => setConsentedRootKeys(previous => {
                const next = new Set(previous);
                if (event.target.checked) next.add(key); else next.delete(key);
                return next;
              })} />
            <span><strong>{root.label || root.id}</strong><br />
              <small>{subtreeCount} {subtreeCount === 1 ? 'item' : 'items'} in this retired group</small>
            </span>
          </label>;
        })}
      </fieldset>
      {discovery.autoRetainedRoots.length > 0 && <p style={{ margin: '0 0 10px', fontSize: 12,
        color: '#aeb7c5' }}>Unchecked roots stay available. Nothing is retired until final review and apply.</p>}
      {error && <p role="alert" style={{ color: '#ffb3b3' }}>{error}</p>}
      <button type="button" disabled={busy || requestPending || !allChecked}
        onClick={() => { void requestUpdate(requiredRoots.map(root => ({ kind: root.kind, id: root.id }))); }}>
        {requestPending ? 'Preparing final review…' : 'Continue to final review'}
      </button>
      <button type="button" disabled={busy || requestPending} onClick={resetRequestedUpdate}
        style={{ marginLeft: 8 }}>Back</button>
    </section></BodyPortal>;
  }

  if (!activeReview) {
    if (!available) return error ? <BodyPortal><section role="status"
      data-document-definition-revision-status style={{ position: 'fixed', zIndex: 7550,
        right: 16, bottom: 16, width: 'min(380px, calc(100% - 32px))', padding: 12,
        borderRadius: 8, background: '#202631', color: '#f4f6f8', border: '1px solid #465164' }}>
      {error}
    </section></BodyPortal> : null;
    const surveyChanged = Boolean(surveyTemplate);
    const entityChanged = Boolean(entityTemplate);
    return <BodyPortal><section data-document-definition-revision-offer style={{ position: 'fixed',
      zIndex: 7550, right: 16, bottom: 16, width: 'min(380px, calc(100% - 32px))', padding: 14,
      borderRadius: 10, background: '#202631', color: '#f4f6f8', border: '1px solid #465164',
      boxShadow: '0 8px 24px rgba(0,0,0,.32)' }}>
      <p style={{ margin: '0 0 10px', fontSize: 14 }}>
        Choose either source to change. The other source stays on its current shared version.
      </p>
      {templateOptions.length === 0 && <button type="button" disabled={sourcesLoading || busy}
        onClick={() => { void onLoadSources?.(); }} style={{ marginBottom: 10 }}>
        {sourcesLoading ? 'Loading template sources…' : 'Load template sources'}
      </button>}
      {error && <p role="alert" style={{ color: '#ffb3b3' }}>{error}</p>}
      {templateOptions.length > 0 && <>
      <label style={{ display: 'grid', gap: 4, marginBottom: 8 }}>Survey source
        <select value={surveyTemplateId} onChange={event => changeSurveyTemplate(event.target.value)}>
          <option value="">Keep current survey source</option>
          {templateOptions.map(option => <option key={`survey-${option.id}`} value={option.id}>{option.name}</option>)}
        </select>
      </label>
      <label style={{ display: 'grid', gap: 4, marginBottom: 10 }}>Entity source
        <select value={entityTemplateId} onChange={event => changeEntityTemplate(event.target.value)}>
          <option value="">Keep current entity source</option>
          {templateOptions.map(option => <option key={`entity-${option.id}`} value={option.id}>{option.name}</option>)}
        </select>
      </label>
      <button type="button" disabled={busy || requestPending || (!surveyChanged && !entityChanged)}
        onClick={() => { void requestUpdate([]); }}>
        {requestPending ? 'Checking document update…' : 'Review document update'}
      </button>
      </>}
    </section></BodyPortal>;
  }

  return <BodyPortal><section role="dialog" aria-modal="true" data-document-definition-revision-review
    aria-label="Review document definition update" style={{ position: 'fixed', zIndex: 7650,
      top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      width: 'min(640px, calc(100% - 24px))', padding: 16, borderRadius: 10,
      background: '#202631', color: '#f4f6f8', border: '1px solid #465164',
      boxShadow: '0 12px 32px rgba(0,0,0,.38)' }}>
    <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Apply this document update?</h2>
    <p style={{ margin: '0 0 10px', fontSize: 14 }}>
      This updates the shared survey structure and entity list together. All collaborators will use the new current labels.
      Old revisions stay available for history review.
    </p>
    <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr', marginBottom: 10 }}>
      <Summary label={`Current revision ${activeReview.currentReceipt.definitionRevision}`} value={activeReview.currentReceipt} />
      <Summary label="Proposed update" value={activeReview.wire} />
    </div>
    <DefinitionLabelChanges before={activeReview.currentReceipt} after={activeReview.wire} />
    {error && <p role="alert" style={{ color: '#ffb3b3' }}>{error}</p>}
    <button type="button" disabled={busy} onClick={() => { void onApply?.(); }}>Apply shared update</button>
    <button type="button" disabled={busy} onClick={() => {
      setLocalReviewState(null);
      onCancel?.();
    }} style={{ marginLeft: 8 }}>Keep current definition</button>
  </section></BodyPortal>;
}
