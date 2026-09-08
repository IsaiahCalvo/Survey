export async function persistThenCommitPageMutation({
  file,
  state,
  operation,
  persist,
  commit,
}) {
  if (typeof persist !== 'function') throw new TypeError('persist callback is required');
  await persist(file, state, operation);
  if (state && typeof commit === 'function') commit(state, operation);
  return file;
}
