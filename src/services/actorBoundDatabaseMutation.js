const codes = new Set(['DATABASE_MUTATION_SCOPE_CHANGED', 'DATABASE_MUTATION_ABORTED',
  'DATABASE_MUTATION_INPUT', 'DATABASE_MUTATION_FAILED', '23505', '42501', '23503', '23502',
  '23514', '22023', '40001', '40P01', '55P03', '57014', 'PGRST116', 'PGRST301', 'PGRST302']);
const safeError = (code, mayHaveCommitted = false) => Object.assign(
  new Error('The database change could not be confirmed.'), {
    code: codes.has(code) ? code : 'DATABASE_MUTATION_FAILED', mayHaveCommitted,
  });
const validSignal = signal => signal == null || (typeof signal.aborted === 'boolean'
  && typeof signal.addEventListener === 'function' && typeof signal.removeEventListener === 'function');

/** Run one actor-bound operation, with no retry or rollback claim.
 * request accepts a fresh, lazy SDK query builder factory, never an already
 * dispatched promise. Its response (including SQL errors) is unchanged; callers
 * can handle 23505, but must throw unhandled errors. All stages use the initial
 * JWT, even after a same-actor token refresh. checkCurrent is synchronous;
 * request and final completion additionally recheck the actual session.
 * Publish local state only after this outer promise succeeds. A failure after
 * dispatch may have committed remotely, including when cancellation succeeds.
 * No idle auth listener; retained operation helpers cannot start later work.
 */
export async function runActorBoundDatabaseMutation(options = {}, operation) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw safeError('DATABASE_MUTATION_INPUT');
  const { client, actorUserId, isCurrent, timeoutMs = 60000, signal } = options;
  if (typeof actorUserId !== 'string' || !actorUserId.trim() || actorUserId.length > 256
    || /[\u0000-\u001f\u007f]/.test(actorUserId) || typeof isCurrent !== 'function'
    || typeof client?.auth?.getSession !== 'function' || typeof client?.auth?.onAuthStateChange !== 'function'
    || typeof operation !== 'function' || !validSignal(signal)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120000) {
    throw safeError('DATABASE_MUTATION_INPUT');
  }
  const controller = new AbortController();
  const deadline = performance.now() + timeoutMs;
  let active = true, reason, timer, subscription, accessToken, wrote = false;
  const stop = code => {
    reason ||= safeError(code);
    if (!controller.signal.aborted) controller.abort();
  };
  const checkCurrent = () => {
    if (reason) throw safeError(reason.code, wrote);
    if (!active || controller.signal.aborted || performance.now() >= deadline) {
      stop('DATABASE_MUTATION_ABORTED'); throw safeError(reason.code, wrote);
    }
    let current = false;
    try { current = isCurrent() === true; } catch { /* fail closed */ }
    if (!current) { stop('DATABASE_MUTATION_SCOPE_CHANGED'); throw safeError(reason.code, wrote); }
  };
  const wait = start => {
    checkCurrent();
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (callback, value) => {
        if (done) return;
        done = true; controller.signal.removeEventListener('abort', aborted); callback(value);
      };
      const aborted = () => finish(reject, safeError(reason?.code || 'DATABASE_MUTATION_ABORTED', wrote));
      controller.signal.addEventListener('abort', aborted, { once: true });
      Promise.resolve().then(() => { checkCurrent(); return start(); }).then(value => {
        try { checkCurrent(); finish(resolve, value); } catch (error) { finish(reject, error); }
      }, error => finish(reject, error));
    });
  };
  const readSession = async () => {
    const result = await wait(() => client.auth.getSession());
    checkCurrent();
    const session = result?.data?.session;
    if (result?.error || session?.user?.id !== actorUserId) {
      stop('DATABASE_MUTATION_SCOPE_CHANGED'); throw safeError(reason.code, wrote);
    }
    if (typeof session.access_token !== 'string' || !session.access_token
      || session.access_token.length > 16384 || /[\s\u0000-\u001f\u007f]/.test(session.access_token)) {
      throw safeError('DATABASE_MUTATION_INPUT', wrote);
    }
    return session.access_token;
  };
  const request = async (makeQuery, options = {}) => {
    try {
      checkCurrent();
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw safeError('DATABASE_MUTATION_INPUT');
      const { write = true } = options;
      if (typeof makeQuery !== 'function' || typeof write !== 'boolean') throw safeError('DATABASE_MUTATION_INPUT');
      await readSession(); checkCurrent();
      const result = await wait(() => {
        const query = makeQuery();
        if (typeof query?.setHeader !== 'function' || typeof query?.abortSignal !== 'function'
          || typeof query?.retry !== 'function' || typeof query?.then !== 'function') throw safeError('DATABASE_MUTATION_INPUT');
        const bound = query.setHeader('Authorization', `Bearer ${accessToken}`)
          .abortSignal(controller.signal).retry(false);
        checkCurrent();
        // The lazy builder dispatches on promise assimilation. Mark first: an
        // immediate transport rejection cannot establish that no write reached SQL.
        if (write) wrote = true;
        return bound;
      });
      await readSession(); checkCurrent();
      return result;
    } catch (error) { throw safeError(reason?.code || error?.code, wrote); }
  };
  const onAbort = () => stop('DATABASE_MUTATION_ABORTED');
  try {
    if (signal?.aborted) onAbort();
    checkCurrent();
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    timer = setTimeout(onAbort, timeoutMs);
    const result = client.auth.onAuthStateChange((event, session) => {
      if (active && (event === 'SIGNED_OUT' || session?.user?.id !== actorUserId)) stop('DATABASE_MUTATION_SCOPE_CHANGED');
    });
    subscription = result?.data?.subscription;
    if (typeof subscription?.unsubscribe !== 'function') throw safeError('DATABASE_MUTATION_INPUT');
    checkCurrent();
    accessToken = await readSession(); checkCurrent();
    const value = await wait(() => operation({ request, checkCurrent }));
    await readSession(); checkCurrent();
    return value;
  } catch (error) {
    throw safeError(reason?.code || error?.code, wrote);
  } finally {
    active = false;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (!controller.signal.aborted) controller.abort();
    try { subscription?.unsubscribe(); } catch { /* never leak SDK details */ }
  }
}
