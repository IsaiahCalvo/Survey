import { runActorBoundDatabaseMutation } from '../services/actorBoundDatabaseMutation.js';
import { applyLibraryMutation } from './libraryMutationState.js';

// Own input before any auth await, and publish only in the scope that issued
// the intent. Transport cancellation is not proof of a database rollback.
export function createLibraryMutationRunner({ client, scope, scopeRef, mountedRef,
  readRef, stateScopeRef, setStateScope, setRows, setError, available }) {
  const current = () => mountedRef.current && scopeRef.current === scope && available();
  const changed = (mayHaveCommitted = false) => Object.assign(
    new Error('The database change could not be confirmed.'),
    { code: 'DATABASE_MUTATION_SCOPE_CHANGED', mayHaveCommitted });
  return async (input, operation, changeFor = null) => {
    if (!current()) throw changed();
    let completed = false;
    let transportError;
    try {
      const captured = JSON.parse(JSON.stringify(input));
      let result;
      try {
        result = await runActorBoundDatabaseMutation({
          client, actorUserId: scope.actorId, isCurrent: current,
        }, context => operation(captured, context));
      } catch (error) {
        transportError = error;
        throw error;
      }
      completed = true;
      if (!current()) throw changed(true);
      if (changeFor) {
        const change = JSON.parse(JSON.stringify(changeFor(result)));
        const validRow = row => row && typeof row === 'object' && !Array.isArray(row)
          && typeof row.id === 'string' && row.id.length > 0;
        if ((['upsert', 'update'].includes(change.kind) && !validRow(change.row))
          || (change.kind === 'replace' && (!Array.isArray(change.rows) || !change.rows.every(validRow)))) {
          throw new TypeError('Invalid library response.');
        }
        if (readRef.current?.scope === scope) readRef.current.reconciler.record(change);
        const ownsState = stateScopeRef.current === scope;
        stateScopeRef.current = scope;
        setStateScope(scope);
        setRows(rows => current() ? applyLibraryMutation(ownsState ? rows : [], change) : rows);
      }
      setError(error => current() ? null : error);
      return result;
    } catch (error) {
      const safe = transportError && error === transportError ? error : !current() ? changed(completed) : Object.assign(
        new Error('The database change could not be confirmed.'),
        { code: completed ? 'DATABASE_MUTATION_FAILED' : 'DATABASE_MUTATION_INPUT', mayHaveCommitted: completed });
      if (current()) setError(previous => current() ? safe.message : previous);
      throw safe;
    }
  };
}
