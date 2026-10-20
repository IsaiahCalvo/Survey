// The iOS/Android app's web view ignores <a download> links: Capacitor has no
// download handler, so every export (PDF, Excel, CSV, XFDF, review ZIP) used to
// do nothing in the native app. On native only, catch those clicks, write the
// file to the app's cache folder and open the system share sheet (Save to
// Files, AirDrop, Mail...). The web and Electron builds are untouched.

export function installNativeDownloadShim(win = typeof window !== 'undefined' ? window : null) {
  if (!win?.Capacitor?.isNativePlatform?.()) return false;
  const proto = win.HTMLAnchorElement?.prototype;
  if (!proto || proto.__surveyNativeDownload) return false;
  const originalClick = proto.click;
  proto.__surveyNativeDownload = true;
  // Keep the Blob itself, not just the URL. Callers (annotated PDF, space CSV,
  // space PDF) revoke in the same turn as click(), and WebKit's blob fetch
  // then fails — the share sheet never opens.
  const blobByUrl = new Map();
  const URLCtor = win.URL;
  if (URLCtor?.createObjectURL && !URLCtor.__surveyNativeDownload) {
    const createObjectURL = URLCtor.createObjectURL.bind(URLCtor);
    const revokeObjectURL = URLCtor.revokeObjectURL.bind(URLCtor);
    URLCtor.createObjectURL = (obj) => {
      const url = createObjectURL(obj);
      blobByUrl.set(url, obj);
      return url;
    };
    URLCtor.revokeObjectURL = (url) => {
      blobByUrl.delete(url);
      revokeObjectURL(url);
    };
    URLCtor.__surveyNativeDownload = true;
  }
  proto.click = function click() {
    const name = this.getAttribute('download');
    const href = this.href || '';
    if (name === null || !/^(blob|data):/.test(href)) return originalClick.call(this);
    const held = blobByUrl.get(href);
    shareDownload(href, name || 'download', typeof Blob === 'function' && held instanceof Blob ? held : null).catch((err) => {
      console.warn('[nativeDownload] share failed', err);
    });
  };
  return true;
}

async function shareDownload(href, fileName, snapshot) {
  const blob = snapshot || await fetch(href).then((r) => r.blob());
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const safeName = fileName.replace(/[\\/:*?"<>|]+/g, '_');
  const { uri } = await Filesystem.writeFile({
    path: safeName,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  });
  try {
    await Share.share({ title: safeName, files: [uri] });
  } catch (err) {
    // Closing the share sheet without picking anything is not an error.
    if (!/cancel/i.test(String(err?.message || err))) throw err;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
