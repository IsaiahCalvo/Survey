import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { YDocContext } from './YDocContext.js';
import ReadOnlyGate from './ReadOnlyGate.jsx';
import { createGenerationCollaborationSession } from '../../lib/collab/generationCollaborationSession.js';

const blocked = Object.freeze({ docRole: 'viewer', authorityStatus: 'checking', accessRevoked: true,
  loginExpired: false, isDocShared: null, presenceStatus: 'offline', syncStatus: null });

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
    props.checkedBundle?.pdfGenerationId]);
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
