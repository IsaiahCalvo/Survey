const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_CHUNK_BYTES = 1024 * 1024;
const MAX_BUNDLE_BYTES = 256 * 1024 * 1024 + 16 * 1024 * 1024 + 16 * 1024 + 64;
const error = (code, message) => Object.assign(new Error(`[${code}] ${message}`), { code });

// Streaming sibling of atomicFileWriter: never buffer a whole recovery bundle,
// never unlink/move the destination before replacement, never accept its path
// from IPC. A killed main process can leave its unique partial temporary file;
// renderer loss is handled here, but SIGKILL cannot execute cleanup code.
function createRecoveryBundleWriter({ chooseDestination, authorize,
  filesystem = fs, platform = process.platform, timeoutMs = 120000,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof chooseDestination !== 'function' || typeof authorize !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('Invalid recovery save configuration');
  const sessions = new Map();
  const owners = new Map();
  const targets = new Set();

  function trusted(event) {
    if (!event?.sender || event.sender.isDestroyed() || event.senderFrame !== event.sender.mainFrame || !authorize(event)) {
      throw error('sender', 'Recovery save requires the active app window.');
    }
  }
  function release(session) {
    clearTimer(session.timer);
    for (const [name, listener] of session.listeners) session.owner.removeListener(name, listener);
    if (owners.get(session.owner) === session) owners.delete(session.owner);
    sessions.delete(session.token);
    if (session.targetKey) targets.delete(session.targetKey);
  }
  function cleanup(session) {
    if (session.cleaning) return session.cleaning;
    session.cleaning = (async () => {
      let failure;
      try { await session.handle?.close(); } catch (cause) { failure = cause; }
      session.handle = null;
      if (session.ownsTemporary) {
        try { await filesystem.unlink(session.temporary); session.ownsTemporary = false; }
        catch (cause) { if (cause.code !== 'ENOENT') failure ||= cause; }
      }
      release(session);
      if (failure) throw error('cleanup', 'The partial recovery file could not be removed. Keep the source draft.');
    })();
    return session.cleaning;
  }
  function cancel(session) {
    if (session.committing) {
      // Rename has been submitted, not necessarily committed. Its actual
      // result owns the receipt; a failed rename must never claim success.
      return session.running.then(result => ({ ...result, committed: true }), () => {
        throw error('write', 'Recovery file could not be saved. Keep the source draft and retry.');
      });
    }
    if (!session.aborting) {
      session.cancelled = true;
      clearTimer(session.timer);
      session.aborting = Promise.resolve(session.running).catch(() => {}).then(() => cleanup(session));
    }
    return session.aborting.then(() => ({ success: true }));
  }
  function resetTimer(session) {
    clearTimer(session.timer);
    session.timer = setTimer(() => { void cancel(session).catch(() => {}); }, timeoutMs);
    session.timer?.unref?.();
  }
  function active(session) {
    if (session.cancelled || session.owner.isDestroyed() || session.owner.mainFrame !== session.frame || session.frame.url !== session.url) {
      throw error('cancelled', 'Recovery save was interrupted. Keep the source draft and retry.');
    }
  }
  function resolve(event, token) {
    trusted(event);
    const session = typeof token === 'string' ? sessions.get(token) : null;
    if (!session || session.owner !== event.sender || session.frame !== event.senderFrame || session.url !== event.senderFrame.url) {
      throw error('token', 'This recovery save token does not belong to this window.');
    }
    active(session);
    if (session.running || session.committing) throw error('busy', 'Wait for the previous recovery save step.');
    return session;
  }
  async function operate(session, work) {
    resetTimer(session);
    const pending = Promise.resolve().then(work);
    session.running = pending;
    try { return await pending; }
    catch (cause) {
      session.cancelled = true;
      // Do not await cancel() here: it is waiting for this same operation.
      if (!session.committing) await cleanup(session);
      throw cause?.code && ['sequence', 'chunk', 'truncated', 'cancelled', 'destination', 'busy'].includes(cause.code)
        ? cause : error('write', 'Recovery file could not be saved. Keep the source draft and retry.');
    } finally {
      if (session.running === pending) session.running = null;
      if (sessions.get(session.token) === session && !session.cancelled && !session.committing) resetTimer(session);
    }
  }

  async function start(event, input = {}) {
    trusted(event);
    if (!Number.isSafeInteger(input.totalBytes) || input.totalBytes < 1 || input.totalBytes > MAX_BUNDLE_BYTES
      || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 1024) {
      throw error('input', 'Recovery bundle size or name is invalid.');
    }
    if (owners.has(event.sender)) throw error('busy', 'This window already has a recovery save in progress.');
    const name = input.name.replace(/[\\/\x00-\x1f:]/g, '_').replace(/\.survey-recovery$/i, '').slice(0, 180) + '.survey-recovery';
    const session = { token: randomUUID(), owner: event.sender, frame: event.senderFrame, url: event.senderFrame.url,
      total: input.totalBytes, written: 0, listeners: [], cancelled: false, committing: false };
    owners.set(session.owner, session);
    sessions.set(session.token, session);
    for (const name of ['destroyed', 'render-process-gone', 'did-start-loading']) {
      const listener = () => { void cancel(session).catch(() => {}); };
      session.owner.on(name, listener); session.listeners.push([name, listener]);
    }
    return operate(session, async () => {
      const result = await chooseDestination(event, { title: 'Save recovery bundle', defaultPath: name,
        filters: [{ name: 'Survey recovery bundle', extensions: ['survey-recovery'] }] });
      active(session);
      if (result.canceled || !result.filePath) { session.cancelled = true; await cleanup(session); return { canceled: true }; }
      if (typeof result.filePath !== 'string' || !path.isAbsolute(result.filePath) || !/\.survey-recovery$/i.test(result.filePath)) {
        throw error('destination', 'Choose a file with the .survey-recovery extension.');
      }
      // Resolve parent aliases before locking or deriving the sibling temp.
      // Do not realpath the destination itself: atomic rename replaces a
      // destination symlink, it must not follow and overwrite its referent.
      const selected = path.resolve(result.filePath);
      const parent = await filesystem.realpath(path.dirname(selected));
      active(session);
      const target = path.join(parent, path.basename(selected));
      // macOS/Windows commonly treat filename case (and macOS Unicode forms)
      // as aliases. Conservatively serialize them even on case-sensitive
      // volumes, without changing the user's actual selected filename.
      const targetKey = ['darwin', 'win32'].includes(platform) ? target.normalize('NFC').toLowerCase() : target;
      if (targets.has(targetKey)) throw error('busy', 'Another window is saving this recovery file.');
      targets.add(targetKey); session.target = target; session.targetKey = targetKey;
      session.temporary = `${target}.survey-recovery-${randomUUID()}.tmp`;
      let mode = 0o600;
      try { mode = (await filesystem.stat(target)).mode & 0o777; }
      catch (cause) { if (cause.code !== 'ENOENT') throw cause; }
      active(session);
      session.handle = await filesystem.open(session.temporary, 'wx', mode);
      session.ownsTemporary = true;
      active(session);
      return { canceled: false, token: session.token, maxChunkBytes: MAX_CHUNK_BYTES };
    });
  }
  function append(event, input = {}) {
    const session = resolve(event, input.token);
    // Freeze this one bounded chunk before any async work can observe caller
    // mutation. IPC also clones bytes, but the writer keeps its own invariant.
    const chunkOffset = input.offset;
    const data = input.data;
    let bytes, invalid;
    if (!Number.isSafeInteger(chunkOffset) || chunkOffset !== session.written) invalid = error('sequence', 'Recovery chunks must arrive in order.');
    else if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) invalid = error('chunk', 'Recovery chunk must contain bytes.');
    else if (data.byteLength < 1 || data.byteLength > MAX_CHUNK_BYTES || data.byteLength > session.total - session.written) invalid = error('chunk', 'Recovery chunk exceeds its declared size.');
    else bytes = Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    return operate(session, async () => {
      active(session);
      if (invalid) throw invalid;
      let offset = 0;
      while (offset < bytes.length) {
        active(session);
        const result = await session.handle.write(bytes, offset, bytes.length - offset, session.written + offset);
        if (!Number.isInteger(result.bytesWritten) || result.bytesWritten <= 0 || result.bytesWritten > bytes.length - offset) throw error('write', 'Recovery write did not make progress.');
        offset += result.bytesWritten;
      }
      active(session); session.written += bytes.length;
      return { success: true, bytesWritten: session.written };
    });
  }
  function finish(event, input = {}) {
    const session = resolve(event, input.token);
    return operate(session, async () => {
      active(session);
      if (session.written !== session.total) throw error('truncated', 'Recovery file is incomplete.');
      await session.handle.sync(); active(session);
      await session.handle.close(); session.handle = null; active(session);
      // The rename is the commit point. Cancellation cannot undo a rename
      // already submitted to the OS; report committed success honestly.
      session.committing = true; clearTimer(session.timer);
      try { await filesystem.rename(session.temporary, session.target); }
      catch (cause) { session.committing = false; throw cause; }
      session.ownsTemporary = false;
      let durabilityWarning;
      if (platform !== 'win32') {
        let directory;
        try { directory = await filesystem.open(path.dirname(session.target), 'r'); await directory.sync(); }
        catch { durabilityWarning = 'The recovery file was written, but its directory flush was not confirmed. Keep the source draft.'; }
        finally { try { await directory?.close(); } catch { durabilityWarning ||= 'The recovery file was written, but its directory close was not confirmed. Keep the source draft.'; } }
      }
      release(session);
      return { success: true, ...(durabilityWarning ? { durabilityWarning } : {}) };
    });
  }
  function abort(event, input = {}) {
    // Abort may interrupt a pending append; unlike append/finish it need not
    // wait for the renderer to receive the previous acknowledgement first.
    trusted(event);
    const session = sessions.get(input.token);
    if (!session || session.owner !== event.sender || session.frame !== event.senderFrame || session.url !== event.senderFrame.url) throw error('token', 'Invalid recovery save token.');
    return cancel(session);
  }
  return { start, append, finish, abort };
}

module.exports = { createRecoveryBundleWriter, MAX_CHUNK_BYTES, MAX_BUNDLE_BYTES };
