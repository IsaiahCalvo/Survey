// src/electron/msalCacheStore.cjs
//
// Persistence plugin for the main-process MSAL token cache (PLAN.md Amendment
// 2026-06-08(b) #5: "main-process token custody"). The MSAL cache — including
// refresh tokens — lives ONLY in the Electron main process, serialized to one
// file under userData and encrypted with Electron safeStorage (Keychain-backed
// on macOS). If OS-level encryption is unavailable, the cache is NOT persisted
// at all (in-memory only — the user re-signs-in next launch); we never write
// refresh tokens to disk in plaintext.
//
// Dependency-injected (fs, encrypt/decrypt) so the logic is unit-testable
// outside Electron. A corrupt or undecryptable file is treated as an empty
// cache (fail to a fresh sign-in, never crash the app).

const createMsalCacheStore = ({
  filePath,
  fs,
  encrypt, // (plaintextString) => Buffer
  decrypt, // (Buffer) => plaintextString
  isEncryptionAvailable, // () => boolean
  log = () => {}
}) => {
  const canPersist = () => {
    try {
      return Boolean(filePath) && Boolean(isEncryptionAvailable && isEncryptionAvailable());
    } catch {
      return false;
    }
  };

  const readPersistedCache = () => {
    if (!canPersist()) return null;
    try {
      if (!fs.existsSync(filePath)) return null;
      const blob = fs.readFileSync(filePath);
      if (!blob || blob.length === 0) return null;
      return decrypt(blob);
    } catch (err) {
      // Corrupt/undecryptable cache (OS keychain reset, file damage, crash mid-
      // write) → self-heal by deleting it and starting empty; the user simply
      // signs in again — and the next launch doesn't hit the same failure.
      log(`MSAL cache unreadable, starting fresh: ${err?.message || err}`);
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        /* best-effort cleanup */
      }
      return null;
    }
  };

  const writePersistedCache = (serialized) => {
    if (!canPersist()) return false;
    try {
      // Atomic write (tmp + rename) so a crash mid-write can't truncate the cache.
      const tmpPath = `${filePath}.tmp`;
      fs.writeFileSync(tmpPath, encrypt(serialized), { mode: 0o600 });
      fs.renameSync(tmpPath, filePath);
      return true;
    } catch (err) {
      log(`MSAL cache write failed (kept in memory): ${err?.message || err}`);
      return false;
    }
  };

  const removePersistedCache = () => {
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  };

  // The ICachePlugin shape @azure/msal-node consumes.
  const cachePlugin = {
    beforeCacheAccess: async (cacheContext) => {
      const serialized = readPersistedCache();
      if (serialized) cacheContext.tokenCache.deserialize(serialized);
    },
    afterCacheAccess: async (cacheContext) => {
      if (cacheContext.cacheHasChanged) {
        writePersistedCache(cacheContext.tokenCache.serialize());
      }
    }
  };

  return { cachePlugin, canPersist, readPersistedCache, writePersistedCache, removePersistedCache };
};

module.exports = { createMsalCacheStore };
