// Password tools, run by qpdf compiled to WebAssembly (qpdf is Apache-2.0, the
// wasm build ISC). The engine is ~1.3 MB, so it loads only when a tool needs it.
// `load()` resolves to the emscripten module; the browser passes one that
// fetches the wasm (see browser.js) and the tests one that reads it from disk.
// This build sends qpdf's messages straight to console.error (it ignores
// printErr), so failures are told apart by exit code and by whether the input
// is encrypted.
import { ToolError } from './errors.js';

export function qpdfRunner(load) {
  let ready;
  return async (bytes, args) => {
    ready ||= load().catch((err) => { ready = null; throw err; });
    const q = await ready;
    q.FS.writeFile('/in.pdf', bytes);
    let code;
    try {
      code = q.callMain([...args, '/in.pdf', '/out.pdf']);
    } catch (err) {
      code = typeof err?.status === 'number' ? err.status : 2;
    }
    let out = null;
    // 3 means it worked, with warnings (common with slightly damaged files).
    if (code === 0 || code === 3) {
      try { out = q.FS.readFile('/out.pdf'); } catch { out = null; }
    }
    for (const f of ['/in.pdf', '/out.pdf']) {
      try { q.FS.unlink(f); } catch { /* not written */ }
    }
    return { code, out };
  };
}

// Owner password: when the file limits printing or copying, a random one that
// nobody knows, so the open password can't be used to lift the limits.
function ownerPassword(user, limited) {
  if (!limited) return user;
  const b = new Uint8Array(18);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function protectPdf(run, bytes, { password = '', allowPrint = true, allowCopy = true } = {}) {
  if (!password) throw new ToolError('Type a password first.');
  const limited = !allowPrint || !allowCopy;
  // The --name=value form keeps a password that starts with "-" from being
  // read as an option.
  const args = ['--encrypt', `--user-password=${password}`, `--owner-password=${ownerPassword(password, limited)}`, '--bits=256'];
  if (!allowPrint) args.push('--print=none');
  if (!allowCopy) args.push('--extract=n');
  args.push('--');
  const r = await run(bytes, args);
  if (!r.out) {
    if (looksEncrypted(bytes)) throw new ToolError('This PDF already has a password. Unlock it first, then set a new one.');
    throw new ToolError('This file could not be read as a PDF. It may be damaged.');
  }
  return r.out;
}

export async function unlockPdf(run, bytes, { password = '' } = {}) {
  // qpdf reads an empty --password= as a usage error; no flag means "none".
  const r = await run(bytes, password ? [`--password=${password}`, '--decrypt'] : ['--decrypt']);
  if (!r.out) {
    if (looksEncrypted(bytes)) {
      throw new ToolError(password ? 'That password isn\'t right. Check it and try again.' : 'This PDF needs its password to open. Type it in, then try again.');
    }
    throw new ToolError('This file could not be read as a PDF. It may be damaged.');
  }
  return r.out;
}

// Whether a PDF has an /Encrypt entry. A cheap byte scan, so it can be wrong
// the safe way (a stray "/Encrypt" in a page only costs an extra decrypt pass).
const NEEDLE = [0x2f, 0x45, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74];
export function looksEncrypted(bytes) {
  const n = bytes.length - NEEDLE.length;
  for (let i = bytes.indexOf(0x2f); i !== -1 && i <= n; i = bytes.indexOf(0x2f, i + 1)) {
    let k = 1;
    while (k < NEEDLE.length && bytes[i + k] === NEEDLE[k]) k += 1;
    if (k === NEEDLE.length) return true;
  }
  return false;
}
