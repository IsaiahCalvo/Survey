// Display-only presence. Deployment requires private Realtime policies for this
// exact topic and presence key; peer payloads NEVER establish actor authority.
// No document updates, Y.Doc, SQL writes, or legacy transport are used here.
export const GENERATION_PRESENCE_LIMITS = Object.freeze({
  peers: 128, scannedKeys: 512, metasPerKey: 8, name: 80, annotationId: 256,
  ttlMs: 120_000, heartbeatMs: 30_000, maintenanceMs: 15_000, timeoutMs: 5000,
});

const owners = new WeakMap();
const uuid = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
const text = (value, limit) => typeof value === 'string'
  ? value.slice(0, limit * 4).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, limit) : '';
const color = value => Number.isInteger(value) && value >= 1 && value <= 6 ? value : 1;
const copyState = state => ({ user: { ...state.user }, editingAnnotationId: state.editingAnnotationId });
const safely = (callback, ...args) => { try { callback?.(...args); } catch { /* UI callbacks cannot break cleanup. */ } };

function bounded(work) {
  let timer;
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Presence timed out')), GENERATION_PRESENCE_LIMITS.timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}

/** One owner per client/topic. A duplicate live owner throws explicitly; a
 * StrictMode remount waits for the old owner's channel removal. Sharing one
 * topic across multiple mounted consumers requires a separate shared runtime.
 * onChange receives a detached Map; onStatus receives a status string.
 */
export function createGenerationPresence({
  client, documentId, actorUserId, pdfGenerationId, isCurrent, authorize,
  isActive = true, onChange, onStatus, now = Date.now,
}) {
  if (!uuid(documentId) || !uuid(actorUserId) || !uuid(pdfGenerationId)
    || typeof client?.channel !== 'function' || typeof client?.removeChannel !== 'function' || typeof client?.getChannels !== 'function'
    || typeof isCurrent !== 'function' || typeof authorize !== 'function' || typeof now !== 'function'
    || typeof isActive !== 'boolean') throw new TypeError('A checked generation presence scope is required');
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('Secure presence identity is unavailable');
  const topic = `generation-presence:${documentId}:${pdfGenerationId}`;
  let topics = owners.get(client);
  if (!topics) { topics = new Map(); owners.set(client, topics); }
  let slot = topics.get(topic);
  if (slot?.owner) throw Object.assign(new Error('This client already owns this generation presence topic'), {
    code: 'GENERATION_PRESENCE_SCOPE_IN_USE',
  });
  if (!slot) { slot = { owner: null, closing: Promise.resolve(true) }; topics.set(topic, slot); }
  const owner = Symbol(topic);
  slot.owner = owner;
  const clientID = globalThis.crypto.randomUUID();
  const presenceKey = `${actorUserId}:${clientID}`;
  let disposed = false;
  let active = isActive;
  let epoch = 0;
  let entry = null;
  let timer = null;
  let status = null;
  let states = new Map();
  let signature = '[]';
  let local = { user: { id: actorUserId, name: 'Collaborator', colorSlot: 1 }, editingAnnotationId: null };
  const listeners = new Set();
  const scopeCurrent = () => {
    try { return !disposed && slot.owner === owner && isCurrent() === true; } catch { return false; }
  };
  const current = candidate => scopeCurrent() && active && entry === candidate && !candidate.closed;
  const emitStatus = value => {
    if (disposed && value !== 'disposed') return;
    if (status !== value) { status = value; safely(onStatus, value); }
  };
  const snapshot = () => scopeCurrent() ? new Map([...states].map(([key, value]) => [key, copyState(value)])) : new Map();
  const publish = next => {
    const nextSignature = JSON.stringify([...next]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    states = next;
    safely(onChange, snapshot());
    for (const listener of [...listeners]) safely(listener);
  };

  function readPresence(candidate) {
    if (!current(candidate) || !candidate.authorized) return;
    const next = new Map();
    const timestamps = new Map();
    const time = now();
    if (!Number.isSafeInteger(time)) { stop('offline'); return; }
    if (candidate.localTracked) next.set(clientID, copyState(local));
    let raw;
    try { raw = candidate.channel.presenceState(); } catch { stop('offline'); return; }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      let scanned = 0;
      for (const key in raw) {
        if (++scanned > GENERATION_PRESENCE_LIMITS.scannedKeys || next.size >= GENERATION_PRESENCE_LIMITS.peers) break;
        if (!Object.hasOwn(raw, key) || key === presenceKey || key.length > 80 || !Array.isArray(raw[key])) continue;
        for (let index = 0; index < Math.min(raw[key].length, GENERATION_PRESENCE_LIMITS.metasPerKey); index++) {
          if (next.size >= GENERATION_PRESENCE_LIMITS.peers) break;
          const value = raw[key][index];
          if (!value || value.version !== 1 || value.documentId !== documentId || value.pdfGenerationId !== pdfGenerationId
            || !uuid(value.clientID) || value.clientID === clientID || !uuid(value.user?.id)
            || key !== `${value.user.id}:${value.clientID}` || !Number.isSafeInteger(value.updatedAt)
            || value.updatedAt > time + GENERATION_PRESENCE_LIMITS.heartbeatMs
            || value.updatedAt <= time - GENERATION_PRESENCE_LIMITS.ttlMs) continue;
          if ((timestamps.get(value.clientID) ?? -1) >= value.updatedAt) continue;
          timestamps.set(value.clientID, value.updatedAt);
          // Only display fields survive. Roles, arbitrary nested data and HTML
          // capabilities are never copied into the awareness facade.
          next.set(value.clientID, { user: { id: value.user.id,
            name: text(value.user.name, GENERATION_PRESENCE_LIMITS.name) || 'Collaborator', colorSlot: color(value.user.colorSlot) },
          editingAnnotationId: text(value.editingAnnotationId, GENERATION_PRESENCE_LIMITS.annotationId) || null });
        }
      }
    }
    publish(next);
  }

  function closeEntry(candidate) {
    if (!candidate || candidate.closed) return slot.closing;
    candidate.closed = true;
    candidate.authorized = false;
    // untrack is ordered after any track already sent on this owned channel.
    // Remove even when untrack fails; never fall back to a public channel.
    const closing = (async () => {
      try { await bounded(() => candidate.channel.untrack({ timeout: GENERATION_PRESENCE_LIMITS.timeoutMs })); } catch { /* removal still required */ }
      try { return await bounded(() => client.removeChannel(candidate.channel)) === 'ok'; } catch { return false; }
    })();
    slot.closing = closing;
    return closing;
  }

  function stop(reason) {
    epoch++;
    const previous = entry;
    entry = null;
    if (timer !== null) clearInterval(timer);
    timer = null;
    closeEntry(previous);
    publish(new Map());
    emitStatus(reason);
  }

  function track(candidate) {
    if (!current(candidate) || !candidate.authorized) return;
    candidate.dirty = true;
    if (candidate.tracking) return;
    candidate.tracking = true;
    const join = candidate.join;
    void (async () => {
      try {
        while (current(candidate) && candidate.authorized && candidate.join === join && candidate.dirty) {
          candidate.dirty = false;
          const time = now();
          if (!Number.isSafeInteger(time)) throw new Error('Invalid presence clock');
          const payload = { version: 1, documentId, pdfGenerationId, clientID, updatedAt: time, ...copyState(local) };
          const result = await bounded(() => {
            if (!current(candidate) || !candidate.authorized || candidate.join !== join) return null;
            return candidate.channel.track(payload, { timeout: GENERATION_PRESENCE_LIMITS.timeoutMs });
          });
          if (!current(candidate) || candidate.join !== join) return;
          if (result !== 'ok') throw new Error('Private presence track failed');
          candidate.localTracked = true;
          candidate.lastTrackedAt = time;
          emitStatus('online');
          readPresence(candidate);
        }
      } catch {
        if (current(candidate) && candidate.join === join) stop('offline');
      } finally {
        candidate.tracking = false;
        if (current(candidate) && candidate.authorized && candidate.dirty) track(candidate);
      }
    })();
  }

  function joined(candidate, result) {
    if (!current(candidate)) return;
    candidate.join++;
    const join = candidate.join;
    candidate.authorized = false;
    candidate.localTracked = false;
    publish(new Map());
    if (result !== 'SUBSCRIBED') {
      // Let the private SDK channel reconnect, but no peer data or local track
      // is accepted until its next join has passed a fresh authority check.
      emitStatus('offline');
      return;
    }
    emitStatus('connecting');
    void bounded(() => current(candidate) && candidate.join === join ? authorize() : false).then(allowed => {
      if (!current(candidate) || candidate.join !== join) return;
      if (allowed !== true) { stop('unauthorized'); return; }
      candidate.authorized = true;
      readPresence(candidate);
      track(candidate);
    }, () => { if (current(candidate) && candidate.join === join) stop('unauthorized'); });
  }

  async function start() {
    const attempt = ++epoch;
    emitStatus('connecting');
    const removed = await slot.closing;
    if (!scopeCurrent() || !active || epoch !== attempt) return;
    if (!removed) { emitStatus('offline'); return; }
    try {
      // The SDK returns an existing channel for the same topic. Never borrow
      // an unknown owner's instance or change its privacy configuration.
      if (client.getChannels().some(channel => channel.topic === `realtime:${topic}` || channel.subTopic === topic)) {
        throw new Error('Presence topic already exists');
      }
      const channel = client.channel(topic, { config: { private: true, presence: { key: presenceKey, enabled: true } } });
      const candidate = { channel, closed: false, join: 0, authorized: false, localTracked: false,
        tracking: false, dirty: false, lastTrackedAt: 0 };
      entry = candidate;
      if (channel.private !== true || channel.params?.config?.private !== true) throw new Error('Private channel unavailable');
      channel.on('presence', { event: 'sync' }, () => readPresence(candidate));
      channel.on('presence', { event: 'join' }, () => readPresence(candidate));
      channel.on('presence', { event: 'leave' }, () => readPresence(candidate));
      channel.subscribe(result => joined(candidate, result), GENERATION_PRESENCE_LIMITS.timeoutMs);
      if (!current(candidate)) return;
      timer = setInterval(() => {
        if (!scopeCurrent()) { stop('unauthorized'); return; }
        if (!current(candidate) || !candidate.authorized) return;
        readPresence(candidate);
        if (now() - candidate.lastTrackedAt >= GENERATION_PRESENCE_LIMITS.heartbeatMs) track(candidate);
      }, GENERATION_PRESENCE_LIMITS.maintenanceMs);
    } catch { stop('offline'); }
  }

  const awareness = Object.freeze({
    clientID,
    getStates: snapshot,
    on(event, listener) { if (!disposed && event === 'change' && typeof listener === 'function') listeners.add(listener); },
    off(event, listener) { if (event === 'change') listeners.delete(listener); },
    setLocalStateField(field, value) {
      if (!scopeCurrent()) return false;
      if (field === 'user') {
        if (!value || typeof value !== 'object' || (value.id !== undefined && value.id !== actorUserId)) return false;
        local = { ...local, user: { id: actorUserId,
          name: text(value.name, GENERATION_PRESENCE_LIMITS.name) || 'Collaborator', colorSlot: color(value.colorSlot) } };
      } else if (field === 'editingAnnotationId') {
        if (value !== null && typeof value !== 'string') return false;
        local = { ...local, editingAnnotationId: text(value, GENERATION_PRESENCE_LIMITS.annotationId) || null };
      } else return false;
      if (entry) track(entry);
      return true;
    },
  });
  const handle = Object.freeze({
    getAwareness: () => awareness,
    setActive(value) {
      if (typeof value !== 'boolean') throw new TypeError('Presence active state must be boolean');
      if (disposed || active === value) return;
      active = value;
      if (active && scopeCurrent()) void start(); else stop('inactive');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stop('disposed');
      listeners.clear();
      slot.owner = null;
      // Keep the removal barrier for a same-topic remount. No shared socket
      // disconnect or other owner's unsubscribe occurs here.
      void slot.closing.then(removed => {
        if (removed && slot.owner === null && topics.get(topic) === slot) topics.delete(topic);
      });
    },
  });
  if (active && scopeCurrent()) void start(); else emitStatus('inactive');
  return handle;
}
