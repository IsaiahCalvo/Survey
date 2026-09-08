// Keep writes ordered across close/reopen for the same client, actor and cloud
// document. Do not release a slot on a timeout: the old request may still write.
const clientQueues = new WeakMap();

export function queueToolPreferenceWrite(client, actorId, documentId, write) {
  let queues = clientQueues.get(client);
  if (!queues) {
    queues = new Map();
    clientQueues.set(client, queues);
  }
  const key = JSON.stringify([actorId, documentId]);
  const previous = queues.get(key) || Promise.resolve();
  const operation = previous.catch(() => undefined).then(write);
  const tracked = operation.finally(() => {
    if (queues.get(key) === tracked) queues.delete(key);
  });
  queues.set(key, tracked);
  return tracked;
}
