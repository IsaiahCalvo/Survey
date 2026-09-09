// Bind the existing journal API once so no generated call can fall back to a
// legacy namespace. Records still carry their own exact scope and key.
export function bindAnnotationGenerationOutbox(store, { documentId, actorUserId, pdfGenerationId }) {
  if (!pdfGenerationId) return store;
  const options = Object.freeze({ documentId, actorUserId, pdfGenerationId });
  const positions = { list:2, listQuarantined:2, loadCleanState:2, readLocalState:3,
    readLocalStateFresh:3, readRetiredScope:3, assertScopeCurrent:3,
    delete:2, deleteMany:2, markRejected:2, deleteFromOrdinal:5, compactAccepted:5, deleteScope:3, retireScope:3 };
  return new Proxy(store, { get(target, name) {
    const method = target[name];
    if (typeof method !== 'function') return method;
    if (Object.hasOwn(positions, name)) return (...args) => {
      const position = positions[name];
      args[position] = { ...args[position], ...options };
      return method.apply(target, args);
    };
    return method.bind(target);
  } });
}
