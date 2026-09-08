// Print previews include 1600px previews and 2000px print rasters. Retain only
// a small LRU; callers/print jobs still own their returned images after eviction.
export const PRINT_PREVIEW_MAX_BYTES = 32 * 1024 * 1024;
export const PRINT_PREVIEW_MAX_ENTRIES = 32;

export function createPrintPreviewCache({
  maxBytes = PRINT_PREVIEW_MAX_BYTES,
  maxEntries = PRINT_PREVIEW_MAX_ENTRIES,
} = {}) {
  const entries = new Map();
  let bytes = 0;
  const remove = (key) => {
    const entry = entries.get(key);
    if (!entry) return;
    bytes -= entry.bytes;
    entries.delete(key);
  };
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      remove(key);
      if (typeof value?.src !== 'string' || !value.src.length) return false;
      // Conservatively count two bytes per JS string code unit, regardless of
      // whether this engine stores an ASCII data URL as a one-byte string.
      const size = value.src.length * 2;
      if (size > maxBytes || maxEntries < 1) return false;
      while (entries.size && (bytes + size > maxBytes || entries.size >= maxEntries)) {
        remove(entries.keys().next().value);
      }
      entries.set(key, { value, bytes: size });
      bytes += size;
      return true;
    },
    clear() { entries.clear(); bytes = 0; },
    get size() { return entries.size; },
    get bytes() { return bytes; },
  };
}
