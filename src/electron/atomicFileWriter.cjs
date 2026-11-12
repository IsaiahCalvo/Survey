const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

// Short and fixed-length on purpose: a name built from the whole target name
// (`<name>.survey-<uuid>.tmp`) pushed valid long file names past the 255
// limit, so the save failed before anything was written.
const temporaryNameFor = (target) => path.join(path.dirname(target), `.survey-${randomBytes(8).toString('hex')}.tmp`);

const tagError = (error, fields) => {
  if (error && typeof error === 'object') {
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && error[key] === undefined) error[key] = value;
    }
  }
  return error;
};

function createAtomicFileWriter({ filesystem = fs, platform = process.platform } = {}) {
  const pending = new Map();
  let keying = Promise.resolve();

  async function write(target, bytes) {
    const temporary = temporaryNameFor(target);
    let handle;
    let ownsTemporary = false;
    let replaced = false;
    try {
      let mode = 0o600;
      try {
        mode = (await filesystem.stat(target)).mode & 0o777;
        // Replacing by rename would get past a read-only file, since only the
        // folder's permission is checked. Refuse like a direct write would.
        if (!(mode & 0o200)) {
          throw Object.assign(new Error(`EACCES: the file is read-only, '${target}'`), { code: 'EACCES', phase: 'check' });
        }
      } catch (error) { if (error.code !== 'ENOENT' || error.phase === 'check') throw error; }
      handle = await filesystem.open(temporary, 'wx', mode);
      ownsTemporary = true;
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = null;

      // Never move or remove the current file first. If replacement fails,
      // its previous bytes remain at the user's chosen path.
      await filesystem.rename(temporary, target);
      ownsTemporary = false;
      replaced = true;

      // POSIX directory sync persists the replacement name. Windows does not
      // expose this operation through Node's directory file handles.
      if (platform !== 'win32') {
        let directory;
        try {
          directory = await filesystem.open(path.dirname(target), 'r');
          await directory.sync();
        } catch (error) {
          if (!['EINVAL', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
        } finally {
          await directory?.close();
        }
      }
      return { success: true };
    } catch (error) {
      // `replaced` tells the caller whether the new bytes are already at the
      // path (a late folder-flush failure) or the old ones are still there.
      tagError(error, { replaced });
      // Never let a failed cleanup replace the real error: the cleanup error
      // and the leftover file ride along on it instead.
      try { await handle?.close(); } catch { /* the main error stands */ }
      handle = null;
      if (ownsTemporary) {
        try { await filesystem.unlink(temporary); }
        catch (cleanupError) {
          if (cleanupError.code !== 'ENOENT') tagError(error, { cleanupError, leftoverTemporary: temporary });
        }
        ownsTemporary = false;
      }
      throw error;
    }
  }

  // Writes that may land on the same file must run in call order, or an older
  // write can finish last and win. Two different strings can name one file
  // (Target.pdf / target.pdf on a case-blind disk, é composed or not, a
  // symlinked folder), so writes queue per real folder, not per spelling.
  async function queueKeyFor(target) {
    const folder = path.dirname(target);
    try { return await (filesystem.realpath || fs.realpath)(folder); }
    catch { return folder; }
  }

  return function writeFileAtomic(filePath, data) {
    const target = path.resolve(filePath);
    const bytes = Buffer.from(data);
    // Keys resolve one after another so queue order is call order.
    const keyed = keying.then(() => queueKeyFor(target));
    keying = keyed.catch(() => {});
    return keyed.then((key) => {
      const previous = pending.get(key) || Promise.resolve();
      const request = previous.catch(() => {}).then(() => write(target, bytes));
      pending.set(key, request);
      const clear = () => { if (pending.get(key) === request) pending.delete(key); };
      request.then(clear, clear);
      return request;
    });
  };
}

module.exports = { createAtomicFileWriter, writeFileAtomic: createAtomicFileWriter() };
