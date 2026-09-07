const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function createAtomicFileWriter({ filesystem = fs, platform = process.platform } = {}) {
  const pending = new Map();

  async function write(target, bytes) {
    const temporary = `${target}.survey-${randomUUID()}.tmp`;
    let handle;
    let ownsTemporary = false;
    try {
      let mode = 0o600;
      try { mode = (await filesystem.stat(target)).mode & 0o777; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
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
    } finally {
      await handle?.close();
      if (ownsTemporary) {
        try { await filesystem.unlink(temporary); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  }

  return function writeFileAtomic(filePath, data) {
    const target = path.resolve(filePath);
    const bytes = Buffer.from(data);
    const previous = pending.get(target) || Promise.resolve();
    const request = previous.catch(() => {}).then(() => write(target, bytes));
    pending.set(target, request);
    const clear = () => { if (pending.get(target) === request) pending.delete(target); };
    request.then(clear, clear);
    return request;
  };
}

module.exports = { createAtomicFileWriter, writeFileAtomic: createAtomicFileWriter() };
