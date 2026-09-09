const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const rowFields = ['id', 'user_id', 'project_id', 'name', 'name_truncated', 'file_size',
  'page_count', 'created_at', 'updated_at', 'locked_at'];
const pageFields = ['version', 'actor_user_id', 'rows', 'has_more', 'next_cursor'];
const allowed = new Set(['42501', '40001', '55P03', '23514', '22023', '54000',
  'PGRST202', 'PGRST301', 'PGRST302', 'DOCUMENT_CATALOG_INPUT', 'DOCUMENT_CATALOG_DISABLED',
  'DOCUMENT_CATALOG_PROTOCOL', 'DOCUMENT_CATALOG_LIMIT', 'DOCUMENT_CATALOG_ABORTED', 'DOCUMENT_CATALOG_ACTOR_CHANGED']);
const failure = (code = 'DOCUMENT_CATALOG_PROTOCOL') => Object.assign(
  new Error('The complete document list could not be loaded. Your saved work was kept.'), { code });
const check = (value, code = 'DOCUMENT_CATALOG_PROTOCOL') => { if (!value) throw failure(code); };
const uuid = value => typeof value === 'string' && UUID.test(value);
const signalLike = value => value == null || (typeof value.aborted === 'boolean'
  && typeof value.addEventListener === 'function' && typeof value.removeEventListener === 'function');
const bound = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;
function exact(value, fields) {
  if (value === null || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === fields.length && fields.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable;
  });
}
function title(name, truncated) {
  if (name === null) return truncated === null;
  if (typeof name !== 'string' || name.length > 2048 || typeof truncated !== 'boolean' || name.includes('\0')) return false;
  let count = 0;
  for (const character of name) {
    const point = character.codePointAt(0);
    if (++count > 1024 || (point >= 0xd800 && point <= 0xdfff)) return false;
  }
  return !truncated || count === 1024;
}
function date(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 40) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|\+00:00)$/.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour < 24 && minute < 60 && second < 60 && Number.isFinite(Date.parse(value));
}
function bytes(value) {
  return value === null || (typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value)
    && BigInt(value) <= 9223372036854775807n);
}
function page(value, { actorUserId, projectId, cursor, limit }) {
  check(exact(value, pageFields) && value.version === 1 && value.actor_user_id === actorUserId
    && Array.isArray(value.rows) && typeof value.has_more === 'boolean');
  check(value.rows.length <= limit, 'DOCUMENT_CATALOG_LIMIT');
  const rows = [];
  for (const row of value.rows) {
    check(exact(row, rowFields) && uuid(row.id) && (cursor === null || row.id > cursor)
      && uuid(row.user_id) && (row.project_id === null || uuid(row.project_id))
      && (projectId === null || row.project_id === projectId)
      && title(row.name, row.name_truncated) && bytes(row.file_size)
      && (row.page_count === null || (Number.isInteger(row.page_count) && row.page_count >= 0 && row.page_count <= 2147483647))
      && date(row.created_at) && date(row.updated_at) && date(row.locked_at));
    const owned = {};
    for (const key of rowFields) owned[key] = row[key];
    rows.push(Object.freeze(owned)); cursor = row.id;
  }
  check(value.has_more ? rows.length === limit && value.next_cursor === cursor : value.next_cursor === null);
  return { version: 1, actor_user_id: actorUserId, rows, has_more: value.has_more, next_cursor: value.next_cursor };
}

/** Default-off, complete metadata catalog. No content/open proof or mutation
 * authority; name_truncated remains explicit and aliases are not supplied.
 * Completion means every page of the protocol was read, not one transaction
 * snapshot: each RPC has its own statement snapshot, so inserts or permission
 * changes between pages can change the set of visible rows.
 * maxBytes counts UTF-8 JSON envelopes accepted across all pages. The supplied
 * SDK parses each HTTP body first; this is not a transport body-size limiter.
 * No idle subscription, cache, retry, partial result or raw-table fallback.
 * isCurrent must retain the caller's opaque auth/scope epoch between reads. */
export function createDocumentCatalogReader({ client, actorUserId, isCurrent, signal,
  enabled = false, timeoutMs = 60000, pageSize = 100, maxPages = 1000,
  maxRows = 100000, maxBytes = 64 * 1024 * 1024 } = {}) {
  let retired = false;
  const pending = new Set();
  const retire = code => { retired = true; for (const abort of pending) abort(code); };
  return Object.freeze({
    dispose() { retire('DOCUMENT_CATALOG_ABORTED'); },
    async read(input = {}) {
      check(enabled === true, 'DOCUMENT_CATALOG_DISABLED');
      check(input !== null && typeof input === 'object' && !Array.isArray(input), 'DOCUMENT_CATALOG_INPUT');
      const { projectId = null, signal: readSignal } = input;
      check(uuid(actorUserId) && (projectId === null || uuid(projectId)) && typeof isCurrent === 'function'
        && typeof client?.auth?.getSession === 'function' && typeof client?.auth?.onAuthStateChange === 'function'
        && typeof client?.rpc === 'function' && signalLike(signal) && signalLike(readSignal)
        && bound(timeoutMs, 120000) && bound(pageSize, 200) && bound(maxPages, 1000)
        && bound(maxRows, 100000) && bound(maxBytes, 64 * 1024 * 1024), 'DOCUMENT_CATALOG_INPUT');
      const controller = new AbortController(), listeners = [], deadline = performance.now() + timeoutMs;
      let reason, timer, subscription, active = true;
      const abort = code => { reason ||= failure(code); controller.abort(); };
      const alive = () => {
        if (reason) throw reason;
        check(!controller.signal.aborted && performance.now() < deadline, 'DOCUMENT_CATALOG_ABORTED');
        check(!retired, 'DOCUMENT_CATALOG_ACTOR_CHANGED');
        let current = false;
        try { current = isCurrent() === true; } catch { /* fail closed */ }
        if (!current) { retire('DOCUMENT_CATALOG_ACTOR_CHANGED'); throw failure('DOCUMENT_CATALOG_ACTOR_CHANGED'); }
      };
      const wait = operation => {
        alive();
        return new Promise((resolve, reject) => {
          let settled = false;
          const finish = (callback, value) => {
            if (settled) return;
            settled = true; controller.signal.removeEventListener('abort', onAbort); callback(value);
          };
          const onAbort = () => finish(reject, reason || failure('DOCUMENT_CATALOG_ABORTED'));
          controller.signal.addEventListener('abort', onAbort, { once: true });
          Promise.resolve().then(() => { alive(); return operation(); }).then(value => {
            try { alive(); finish(resolve, value); } catch (error) { finish(reject, error); }
          }, error => finish(reject, error));
        });
      };
      const readSession = async () => {
        const response = await wait(() => client.auth.getSession()); alive();
        const session = response?.data?.session;
        if (response?.error || session?.user?.id !== actorUserId) {
          retire('DOCUMENT_CATALOG_ACTOR_CHANGED'); throw failure('DOCUMENT_CATALOG_ACTOR_CHANGED');
        }
        check(typeof session.access_token === 'string' && session.access_token.length > 0
          && session.access_token.length <= 16384 && !/[\s\u0000-\u001f\u007f]/.test(session.access_token), 'DOCUMENT_CATALOG_INPUT');
        return session.access_token;
      };
      try {
        alive();
        for (const source of [signal, readSignal].filter(Boolean)) {
          if (source.aborted) { abort('DOCUMENT_CATALOG_ABORTED'); break; }
          const listener = () => abort('DOCUMENT_CATALOG_ABORTED');
          source.addEventListener('abort', listener, { once: true }); listeners.push([source, listener]);
        }
        alive(); pending.add(abort);
        timer = setTimeout(() => abort('DOCUMENT_CATALOG_ABORTED'), timeoutMs);
        const result = client.auth.onAuthStateChange((event, session) => {
          if (active && (event === 'SIGNED_OUT' || session?.user?.id !== actorUserId)) retire('DOCUMENT_CATALOG_ACTOR_CHANGED');
        });
        subscription = result?.data?.subscription;
        check(typeof subscription?.unsubscribe === 'function', 'DOCUMENT_CATALOG_INPUT'); alive();
        const accessToken = await readSession(); alive();
        const rows = [], encoder = new TextEncoder(); let cursor = null, pages = 0, usedBytes = 0;
        for (;;) {
          check(++pages <= maxPages && rows.length < maxRows, 'DOCUMENT_CATALOG_LIMIT');
          const limit = Math.min(pageSize, maxRows - rows.length);
          await readSession(); alive();
          const response = await wait(() => client.rpc('list_document_catalog', {
            p_after_id: cursor, p_limit: limit, p_project_id: projectId,
          }).setHeader('Authorization', `Bearer ${accessToken}`).abortSignal(controller.signal));
          alive();
          if (response?.error) throw failure(allowed.has(response.error.code) ? response.error.code : undefined);
          // Validate the complete bounded primitive shape before serialization;
          // unknown fields, huge strings or caller toJSON methods never run.
          const accepted = page(response?.data, { actorUserId, projectId, cursor, limit });
          usedBytes += encoder.encode(JSON.stringify(accepted)).byteLength;
          check(usedBytes <= maxBytes, 'DOCUMENT_CATALOG_LIMIT'); alive();
          rows.push(...accepted.rows);
          if (!accepted.has_more) break;
          cursor = accepted.next_cursor;
        }
        // Auth events can be missed between clients without broadcast support.
        // A final storage-backed actor read vetoes even the last completed page.
        await readSession(); alive();
        const resultRows = Object.freeze(rows);
        alive(); return Object.freeze({ version: 1, actorUserId, projectId, rows: resultRows });
      } catch (error) {
        throw failure(reason?.code || (allowed.has(error?.code) ? error.code : undefined));
      } finally {
        active = false; pending.delete(abort); controller.abort(); clearTimeout(timer);
        for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
        try { subscription?.unsubscribe(); } catch { /* never expose SDK diagnostics */ }
      }
    },
  });
}
