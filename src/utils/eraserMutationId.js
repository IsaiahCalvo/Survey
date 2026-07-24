const writerScope = globalThis.crypto?.randomUUID?.()
  || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let sequence = 0;

export function formatEraserMutationId(scope, timestamp, counter) {
  return `eraser:${scope}:${Number(timestamp).toString(36)}:${Number(counter).toString(36)}`;
}

export function nextEraserMutationId(now = Date.now()) {
  sequence += 1;
  return formatEraserMutationId(writerScope, now, sequence);
}
