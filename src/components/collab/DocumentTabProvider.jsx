import React from 'react';
import YDocProvider from './YDocProvider.jsx';
import { HookOwnedGeneratedDocumentProvider } from './GeneratedDocumentProvider.jsx';
import { supabase } from '../../supabaseClient.js';

/** Select the data model before mounting the viewer. A checked tab never
 * starts the legacy transport while waiting for its modern writer. */
export default function DocumentTabProvider({ tab, currentActorUserId, isActive,
  closeDocument, children, client = supabase }) {
  if (tab.checkedBundle) {
    return <HookOwnedGeneratedDocumentProvider checkedBundle={tab.checkedBundle}
      currentActorUserId={currentActorUserId} client={client} isActive={isActive}
      closeDocument={closeDocument}>{children}</HookOwnedGeneratedDocumentProvider>;
  }
  if (tab.file?.pdfGenerationId != null) {
    return <div role="alert">This file version needs a verified open. Your saved work was kept.</div>;
  }
  return <YDocProvider docId={tab.file?.id} actorUserId={tab.actorUserId}
    currentActorUserId={currentActorUserId} isActive={isActive} closeDocument={closeDocument}>
    {children({ checkedBundle: null, onGenerationSession: null })}
  </YDocProvider>;
}
