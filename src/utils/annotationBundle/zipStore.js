// A small, dependency-free ZIP writer for the review bundle (KAL-410).
//
// Files are STORED (no compression): the bundle holds PNGs (already
// compressed) plus two short text files, so deflate would save little, and a
// stored ZIP is simple enough to be byte-for-byte deterministic. Every reader
// (Windows Explorer, macOS Archive Utility, 7-Zip, unzip, Python zipfile)
// opens stored entries. UTF-8 names are flagged (general purpose bit 11).
// One fixed timestamp for every entry, so the same inputs give the same bytes.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// MS-DOS date/time, local fields taken as given (no time zone shift), so the
// stamp reads the same everywhere. Years before 1980 cannot be stored.
export function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(Date.UTC(1980, 0, 1));
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: ((d.getUTCHours() & 31) << 11) | ((d.getUTCMinutes() & 63) << 5) | ((d.getUTCSeconds() >> 1) & 31),
    date: (((year - 1980) & 127) << 9) | (((d.getUTCMonth() + 1) & 15) << 5) | (d.getUTCDate() & 31),
  };
}

const encoder = new TextEncoder();
const toBytes = (data) => (typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data));

/**
 * @param {Array<{ name: string, data: string|Uint8Array|ArrayBuffer }>} entries
 * @param {{ date?: Date }} [options]
 * @returns {Uint8Array}
 */
export function createStoredZip(entries, { date } = {}) {
  const { time, date: dosDate } = dosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  const seen = new Set();
  for (const entry of entries) {
    const name = String(entry.name).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!name || seen.has(name)) throw new Error(`Bad or repeated ZIP entry name: ${name}`);
    seen.add(name);
    const nameBytes = encoder.encode(name);
    const data = toBytes(entry.data);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034B50, true);
    local.setUint16(4, 20, true); // version needed: 2.0
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), nameBytes, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014B50, true);
    central.setUint16(4, 20, true); // made by: 2.0, MS-DOS attributes
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, time, true);
    central.setUint16(14, dosDate, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054B50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  if (total > 0xFFFFFFFF || entries.length > 0xFFFF) throw new Error('Bundle is too large for a ZIP file');
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
