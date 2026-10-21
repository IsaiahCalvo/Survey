// Open speed: resolve the source pdf.js opens a cloud PDF from. The per-open
// access check (fetchInfo) and the signed-URL request run at the same time
// instead of one after the other, saving one server round trip before page 1
// on every uncached open. The signed URL is only used when the check passed
// and no cached copy matches; otherwise it is dropped (a wasted, harmless
// signing request on cache hits).
export async function resolveOpenDocumentSource({ fetchInfo, readCached, sign }) {
  const signing = Promise.resolve()
    .then(sign)
    .catch((error) => ({ data: null, error }));
  const info = await fetchInfo();
  if (info?.error || !info?.data) return null;
  const cached = await readCached(info.data);
  if (cached) return { info: info.data, cached };
  const { data: signed, error } = (await signing) || {};
  if (error || !signed?.signedUrl) return null;
  return { info: info.data, signedUrl: signed.signedUrl };
}
