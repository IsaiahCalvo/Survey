// Refresh tokens for Google and Microsoft are kept encrypted (AES-GCM). The
// key comes from SHEET_SYNC_TOKEN_KEY when set, else it is derived from the
// project's service role key, which only server code has. Changing either
// means people sign in to Google or Microsoft again; nothing else breaks.
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function keyFrom(secret) {
  if (!secret) throw new Error('token key missing');
  const material = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('survey-sheet-sync'), info: enc.encode('refresh-token-v1') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** "v1.<iv>.<ciphertext>" for a token. */
export async function encryptToken(token, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(secret);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(String(token))));
  return `v1.${b64(iv)}.${b64(sealed)}`;
}

/** The token back, or throws when the text was not made with this key. */
export async function decryptToken(text, secret) {
  const [v, iv, sealed] = String(text || '').split('.');
  if (v !== 'v1' || !iv || !sealed) throw new Error('token format');
  const key = await keyFrom(secret);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(sealed));
  return dec.decode(plain);
}
