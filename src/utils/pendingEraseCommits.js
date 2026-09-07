// Keep history commands behind gestures already shown by the live preview.
// The tasks stay registered until document persistence and history both finish.
const pending = new Set();
export function trackPendingEraseCommit(task) {
  pending.add(task);
  const remove = () => pending.delete(task);
  task.then(remove, remove);
  return task;
}
export function deferUntilEraseCommitsFinish(command) {
  if (!pending.size) return false;
  Promise.allSettled([...pending]).then(command);
  return true;
}
