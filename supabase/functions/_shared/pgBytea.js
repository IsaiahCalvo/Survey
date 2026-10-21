// PostgreSQL bytea <-> Uint8Array over PostgREST, as hex text ("\x...."), the
// same wire form the app uses (src/services/annotationCheckpointCore.js). Plain
// JS with NO imports, so Deno, Vite and node tests all load the same file.
// PostgREST returns a bytea column as the hex text "\x<pairs>" and casts a hex
// string back to bytea for a bytea parameter, so the annotation WAL round-trips
// through these two functions.

const HEX = '0123456789abcdef';

/** Uint8Array -> "\x<hexpairs>" (the literal PostgreSQL bytea hex text). */
export function bytesToPgHex(u8) {
  let out = '\\x';
  for (let i = 0; i < u8.length; i += 1) {
    out += HEX[(u8[i] >> 4) & 15] + HEX[u8[i] & 15];
  }
  return out;
}

/** "\x<hexpairs>" (or a bare Uint8Array) -> Uint8Array. */
export function pgHexToBytes(value) {
  if (value instanceof Uint8Array) return value;
  const str = typeof value === 'string' ? value : '';
  const hex = str.startsWith('\\x') ? str.slice(2) : str;
  const len = hex.length >> 1;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}
