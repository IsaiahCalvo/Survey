import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { YDocContext } from './YDocContext.js';
import ReadOnlyGate from './ReadOnlyGate.jsx';
import { createGenerationCollaborationSession } from '../../lib/collab/generationCollaborationSession.js';

const blocked = Object.freeze({ docRole: 'viewer', authorityStatus: 'checking', accessRevoked: true,
  loginExpired: false, isDocShared: null, presenceStatus: 'offline', syncStatus: null });

/** The viewer hook owns the writer. This bridge only observes its published
 * handle; it must never open, capture, or close that handle itself. Children
 * stay mounted while the provider waits for successful checked hydration.
 * Replacing the client requires a fresh checked bundle/open. Callback changes
 * alone must not republish a writer that used the previous client.
 */
export function HookOwnedGeneratedDocumentProvider({ checkedBundle, currentActorUserId,
  client, isActive = true, children, ...props }) {
  const scopeRef = useRef(null);
  if (!scopeRef.current || scopeRef.current.checkedBundle !== checkedBundle
    || scopeRef.current.actor !== currentActorUserId || scopeRef.current.client !== client) {
    scopeRef.current = { checkedBundle, actor: currentActorUserId, client };
  }
  const scope = scopeRef.current;
  const openRef = useRef(null);
  if (!openRef.current || openRef.current.scope !== scope || openRef.current.active !== isActive) {
    const previous = openRef.current;
    openRef.current = { scope, active: isActive,
      retainedOpen: !isActive && previous?.scope === scope && previous.active ? previous : null };
  }
  const open = openRef.current;
  const mountedRef = useRef(true);
  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [published, setPublished] = useState(null);
  const onGenerationSession = useCallback(record => {
    const handle = record?.handle;
    if (!mountedRef.current || scopeRef.current !== scope || openRef.current !== open
      || !open.active || currentActorUserId !== checkedBundle?.actorUserId
      || record?.checkedBundle !== checkedBundle || !handle
      || handle.actorUserId !== checkedBundle.actorUserId
      || handle.documentId !== checkedBundle.documentId
      || handle.pdfGenerationId !== checkedBundle.pdfGenerationId
      || (handle.contentModelVersion ?? 1) !== (checkedBundle.contentModelVersion ?? 1)) return false;
    setPublished(previous => previous?.scope === scope && previous.open === open && previous.handle === handle
      ? previous : { scope, open, handle });
    return true;
  }, [scope, open, checkedBundle, currentActorUserId]);
  // Hide retains this sealed same-open handle for local recovery checks. A
  // successful reopen replaces it; an actor/bundle/client change cannot reuse it.
  const generationSession = published?.scope === scope
    && published.open === (isActive ? open : open.retainedOpen)
    ? published.handle : null;
  return <GeneratedDocumentProvider {...props} checkedBundle={checkedBundle}
    currentActorUserId={currentActorUserId} client={client} isActive={isActive}
    generationSession={generationSession}>
    {children({ checkedBundle, onGenerationSession })}
  </GeneratedDocumentProvider>;
}

/** Dormant until app opens pass one checked bundle and matching modern handle.
 * No legacy Y.Doc, undo, data transport, backfill or retry queue is mounted.
 */
export function GeneratedDocumentProvider(props) {
  // This ref survives a keyed inner remount. An old close receipt must stop
  // matching during the first new render, before old passive cleanup runs.
  const openScopeRef = useRef(null), renderedScopeRef = useRef(null);
  renderedScopeRef.current = { checkedBundle: props.checkedBundle, generationSession: props.generationSession, client: props.client };
  openScopeRef.current = renderedScopeRef.current;
  useLayoutEffect(() => {
    openScopeRef.current = renderedScopeRef.current;
    return () => { openScopeRef.current = null; };
  }, []);
  const key = JSON.stringify([props.checkedBundle?.actorUserId, props.checkedBundle?.documentId,
    props.checkedBundle?.pdfGenerationId, props.checkedBundle?.contentModelVersion ?? 1]);
  return <GeneratedDocumentProviderInner key={key} {...props} openScopeRef={openScopeRef} />;
}

function GeneratedDocumentProviderInner({ checkedBundle, generationSession, currentActorUserId,
  client, isActive = true, children, closeDocument, openScopeRef }) {
  const actorRef = useRef(currentActorUserId); actorRef.current = currentActorUserId;
  const runtimeRef = useRef(null);
  const [published, setPublished] = useState({ runtime: null, state: blocked });
  const [reSignInModalOpen, setReSignInModalOpen] = useState(false);
  useEffect(() => {
    let runtime, unsubscribe;
    try {
      runtime = createGenerationCollaborationSession({ checkedBundle, generationSession, client,
        getCurrentActorUserId: () => actorRef.current,
        isCurrentOpen: () => openScopeRef.current?.checkedBundle === checkedBundle
          && openScopeRef.current?.generationSession === generationSession && openScopeRef.current?.client === client,
        isActive });
      runtimeRef.current = runtime;
      const update = () => setPublished({ runtime, state: runtime.getState(), checkedBundle, generationSession, client });
      unsubscribe = runtime.subscribe(update); update();
    } catch { setPublished({ runtime: null, state: blocked }); }
    return () => {
      unsubscribe?.(); runtime?.dispose();
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [checkedBundle, generationSession, client]);
  useLayoutEffect(() => { runtimeRef.current?.checkActor(); }, [currentActorUserId]);
  useEffect(() => { runtimeRef.current?.setActive(isActive); }, [isActive]);
  const runtime = published.runtime;
  const actorMatches = currentActorUserId === checkedBundle?.actorUserId;
  const live = runtime === runtimeRef.current && actorMatches && published.checkedBundle === checkedBundle
    && published.generationSession === generationSession && published.client === client;
  const state = live ? published.state : blocked;
  const value = {
    ...state, ydoc: null, undoManager: null, undoCtx: null, isCRDTEnabled: false,
    isHydrating: state.authorityStatus === 'checking', role: 'unknown', storageState: null,
    // Every generated tab needs retained-legacy close proof, even with no Y.Doc.
    localCloseRequired: true, localCloseSession: live ? runtime?.localCloseSession ?? null : null,
    transportState: state.syncStatus?.healthy === true ? 'connected' : 'offline',
    accessRevoked: state.accessRevoked || !actorMatches,
    generationAwarenessScope: live ? runtime : null,
    getAwareness: () => live ? runtime?.getAwareness() ?? null : null,
    dismissBanner: () => {}, reSignInModalOpen, setReSignInModalOpen,
    // Reauthentication requires a new checked open; a UI setter cannot revive it.
    setLoginExpired: () => {},
    getOriginContext: () => Object.freeze({ source: 'local', userId: actorMatches ? checkedBundle.actorUserId : null }),
    closeDocument: closeDocument || (() => ({ saved: false, reason: 'A checked document close is unavailable.' })),
  };
  return <YDocContext.Provider value={value}>{children}<ReadOnlyGate isActive={isActive} /></YDocContext.Provider>;
}
