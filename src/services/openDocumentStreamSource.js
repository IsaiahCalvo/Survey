// Open speed: resolve the source pdf.js opens a cloud PDF from. On a cold
// (uncached) open, the per-open access check (fetchInfo) and the signed-URL
// request run at the same time instead of one after the other, saving one
// server round trip before page 1. When `deferSign` is true (this device is
// known to hold a cached copy in pdfByteCache), signing waits until fetchInfo
// + readCached confirm a cache miss, avoiding wasted `storage.objects` queries
// and R2 HEAD / r2_reserve ops on every warm reopen.
export async function resolveOpenDocumentSource({ fetchInfo, readCached, sign, deferSign = false }) {
  const startSign = (infoData) => Promise.resolve()
    .then(() => sign(infoData))
    .catch((error) => ({ data: null, error }));
  const signing = deferSign ? null : startSign(undefined);
  const info = await fetchInfo();
  if (info?.error || !info?.data) return null;
  const cached = await readCached(info.data);
  if (cached) return { info: info.data, cached };
  const { data: signed, error } = (await (signing || startSign(info.data))) || {};
  if (error || !signed?.signedUrl) return null;
  return { info: info.data, signedUrl: signed.signedUrl };
}
