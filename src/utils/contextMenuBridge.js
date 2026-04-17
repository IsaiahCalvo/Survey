/**
 * Context menu bridge — a tiny module-level registry of per-page right-click
 * handlers.
 *
 * Why: PAL renders one instance per PDF page. A document-level right-click
 * listener (in contextMenuDiagnostics.js) needs to route the event to the
 * correct PAL's handleContextMenu callback, but plain ES module state beats
 * trying to thread React refs through global listeners. Each PAL registers
 * its dispatcher on mount and unregisters on unmount.
 */

const registry = new Map();

export function register(pageNumber, dispatcher) {
  registry.set(pageNumber, dispatcher);
}

export function unregister(pageNumber) {
  registry.delete(pageNumber);
}

export function lookup(pageNumber) {
  return registry.get(pageNumber) || null;
}

export function listRegistered() {
  return Array.from(registry.keys());
}
