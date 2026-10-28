// Open PDFs from their Cloudflare R2 copy instead of Supabase Storage, where
// downloads cost egress (docs/PDF-R2.md). Behind the rollout flag 'pdf-r2'.
//
// The pdf-file-url edge function answers with a short-lived R2 link only after
// Storage, asked with this person's own token, says they may read the path and
// the copy is the current version. Any other answer (flag off, R2 not set up,
// first open while the copy is made, an error, a slow answer) returns null and
// the caller reads from Supabase exactly as before.
import { isFeatureOn } from '../featureFlags.js';

export const PDF_R2_FLAG = 'pdf-r2';
// The function sits on the open path; past this, Supabase is faster.
export const PDF_R2_LINK_TIMEOUT_MS = 3000;

export async function requestR2PdfLink(client, filePath, {
  flagOn = () => isFeatureOn(PDF_R2_FLAG),
  timeoutMs = PDF_R2_LINK_TIMEOUT_MS,
} = {}) {
  if (!client?.functions || !filePath) return null;
  let on = false;
  try { on = flagOn(); } catch { on = false; }
  if (!on) return null;
  let timer;
  try {
    const answer = await Promise.race([
      client.functions.invoke('pdf-file-url', { body: { path: filePath } }),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
    const url = answer?.error ? null : answer?.data?.url;
    return typeof url === 'string' && /^https?:\/\//.test(url) ? url : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// The whole file from R2, or null to read it from Supabase instead.
export async function downloadPdfFromR2(client, filePath, { fetchImpl = fetch, ...options } = {}) {
  const url = await requestR2PdfLink(client, filePath, options);
  if (!url) return null;
  try {
    // no-store: never the browser's HTTP copy (same rule as the Storage download).
    const response = await fetchImpl(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return new Blob([await response.arrayBuffer()], { type: 'application/pdf' });
  } catch {
    return null;
  }
}
