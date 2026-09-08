// Save an already verified immutable bundle. The native adapter streams only
// bounded chunks; browser download initiation is not a durable-write receipt.
const CHUNK_BYTES = 1024 * 1024;
export function localRecoveryDownloadName(name) {
  const clean = String(name || 'recovery').replace(/\.pdf$/i, '').replace(/[<>:"|?*\\/\x00-\x1f\x7f]/g, '_').trim();
  // Bound UTF-8 bytes too: a valid display name may exceed filesystem limits.
  let stem = ''; let length = 0;
  for (const character of clean) {
    const size = new TextEncoder().encode(character).length;
    if (length + size > 180) break;
    stem += character; length += size;
  }
  stem = stem.replace(/[. ]+$/, '') || 'recovery';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  return `${stem}.survey-recovery`;
}
export async function saveLocalRecoveryBundle(blob, name, { window = globalThis.window, isCurrent = () => true } = {}) {
  const captured = Blob.prototype.slice.call(blob);
  const check = () => { if (!isCurrent()) throw new Error('Recovery export was canceled. The source snapshot was kept.'); };
  check();
  const native = window?.electronAPI;
  if (native) {
    for (const method of ['startRecoveryBundleSave', 'appendRecoveryBundleSave', 'finishRecoveryBundleSave', 'abortRecoveryBundleSave']) {
      if (typeof native[method] !== 'function') throw new Error('This desktop version cannot save recovery files. Update the app and keep this snapshot.');
    }
    const selected = await native.startRecoveryBundleSave({ name: localRecoveryDownloadName(name), totalBytes: captured.size });
    if (selected?.canceled) return { canceled: true };
    const token = selected?.token;
    if (typeof token !== 'string' || !token) throw new Error('The recovery save could not be started.');
    let complete = false;
    try {
      check();
      if (selected.maxChunkBytes !== CHUNK_BYTES) throw new Error('The recovery save protocol is not supported.');
      for (let offset = 0; offset < captured.size; offset += CHUNK_BYTES) {
        check();
        const data = new Uint8Array(await Blob.prototype.arrayBuffer.call(Blob.prototype.slice.call(captured, offset, offset + CHUNK_BYTES)));
        check();
        const receipt = await native.appendRecoveryBundleSave({ token, offset, data });
        if (receipt?.success !== true || receipt.bytesWritten !== offset + data.byteLength) throw new Error('The recovery save did not confirm its bytes.');
      }
      check();
      const receipt = await native.finishRecoveryBundleSave({ token });
      if (receipt?.success !== true) throw new Error('The recovery file was not saved.');
      complete = true;
      return { saved: true, durabilityWarning: receipt.durabilityWarning || null };
    } finally { if (!complete) await native.abortRecoveryBundleSave({ token }).catch(() => {}); }
  }
  check();
  const url = window.URL.createObjectURL(captured);
  const link = window.document.createElement('a');
  try {
    link.href = url; link.download = localRecoveryDownloadName(name); link.style.display = 'none';
    window.document.body.appendChild(link); check(); link.click();
  } catch (error) { window.URL.revokeObjectURL(url); throw error; }
  finally { link.remove(); }
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
  return { downloadStarted: true };
}
