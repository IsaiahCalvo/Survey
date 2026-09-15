import { runActorBoundDatabaseMutation } from './actorBoundDatabaseMutation.js';
import { createDocumentDefinitionRevisionClient,
  DocumentDefinitionRevisionClientError } from './documentDefinitionRevisionClient.js';

const WRITE_RPC = 'apply_reviewed_document_definition_revision';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const subscriptionError = (code, message) => new DocumentDefinitionRevisionClientError(code, message);

export function createDocumentDefinitionRevisionAppClient({ client, enabled = false,
  getActorUserId, isCurrent } = {}) {
  const revisionClient = createDocumentDefinitionRevisionClient({ enabled, getActorUserId, isCurrent,
    rpc: async (name, args, { signal } = {}) => {
      const actorUserId = getActorUserId();
      const documentId = args?.p_document_id;
      try {
        return await runActorBoundDatabaseMutation({ client, actorUserId, signal,
          isCurrent: () => isCurrent({ actorUserId, documentId }) === true },
        ({ request }) => request(() => client.rpc(name, args), { write: name === WRITE_RPC }));
      } catch (error) {
        if (error?.code === 'DATABASE_MUTATION_SCOPE_CHANGED') {
          throw new DocumentDefinitionRevisionClientError(
            'DOCUMENT_DEFINITION_REVISION_STALE', 'The document or account changed.');
        }
        throw error;
      }
    },
  });
  const subscribeCurrent = ({ documentId, signal, onInvalidate } = {}) => {
    const actorUserId = getActorUserId();
    const validSignal = signal == null || (typeof signal.aborted === 'boolean'
      && typeof signal.addEventListener === 'function'
      && typeof signal.removeEventListener === 'function');
    if (!enabled || typeof actorUserId !== 'string' || !UUID.test(actorUserId)
      || typeof documentId !== 'string' || !UUID.test(documentId)
      || typeof onInvalidate !== 'function' || !validSignal
      || typeof client?.channel !== 'function' || typeof client?.removeChannel !== 'function') {
      throw subscriptionError('DOCUMENT_DEFINITION_REVISION_INPUT',
        'The document definition subscription is invalid.');
    }
    let scopeCurrent = false;
    try { scopeCurrent = signal?.aborted !== true
      && isCurrent({ actorUserId, documentId }) === true; } catch { /* fail closed */ }
    if (!scopeCurrent) throw subscriptionError('DOCUMENT_DEFINITION_REVISION_STALE',
      'The document or account changed.');
    let disposed = false;
    let channel = null;
    let channelRemoved = false;
    let abortListenerAdded = false;
    const current = () => {
      if (disposed || signal?.aborted === true) return false;
      try {
        return getActorUserId() === actorUserId
          && isCurrent({ actorUserId, documentId }) === true;
      } catch { return false; }
    };
    const removeCurrentChannel = () => {
      if (channel && !channelRemoved) {
        channelRemoved = true;
        try { Promise.resolve(client.removeChannel?.(channel)).catch(() => {}); }
        catch { /* best-effort teardown */ }
      }
    };
    const dispose = () => {
      if (!disposed) {
        disposed = true;
        if (abortListenerAdded) {
          abortListenerAdded = false;
          signal.removeEventListener('abort', dispose);
        }
      }
      // A synchronous abort can run while client.channel() is still creating
      // the channel. A later dispose call must remove that late result once.
      removeCurrentChannel();
    };
    const wake = () => {
      if (!current()) { dispose(); return; }
      onInvalidate();
    };
    const suffix = globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      if (signal) {
        abortListenerAdded = true;
        signal.addEventListener('abort', dispose, { once:true });
        if (signal.aborted) { dispose(); return dispose; }
      }
      channel = client.channel(`document-definition:${documentId}:${suffix}`);
      if (disposed) { dispose(); return dispose; }
      const configured = channel.on('postgres_changes', {
        event:'UPDATE', schema:'public', table:'documents', filter:`id=eq.${documentId}`,
      }, wake);
      if (disposed) { dispose(); return dispose; }
      configured.subscribe(status => { if (status === 'SUBSCRIBED') wake(); });
      return dispose;
    } catch (error) {
      dispose();
      throw error;
    }
  };
  return Object.freeze({ ...revisionClient, subscribeCurrent });
}
