import { runActorBoundDatabaseMutation } from './actorBoundDatabaseMutation.js';
import { createDocumentDefinitionRevisionClient,
  DocumentDefinitionRevisionClientError } from './documentDefinitionRevisionClient.js';

const WRITE_RPC = 'apply_reviewed_document_definition_revision';

export function createDocumentDefinitionRevisionAppClient({ client, enabled = false,
  getActorUserId, isCurrent } = {}) {
  return createDocumentDefinitionRevisionClient({ enabled, getActorUserId, isCurrent,
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
}
