import { useEffect, useState } from 'react';

const readOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/**
 * Whether the device says it is online, kept current through the browser's
 * 'online' / 'offline' events. The sync light reads it so it turns to
 * "Offline" the moment the signal drops instead of waiting for a save to fail.
 */
export default function useBrowserOnline() {
  const [online, setOnline] = useState(readOnline);
  useEffect(() => {
    if (typeof globalThis.addEventListener !== 'function') return undefined;
    const update = () => setOnline(readOnline());
    globalThis.addEventListener('online', update);
    globalThis.addEventListener('offline', update);
    update();
    return () => {
      globalThis.removeEventListener('online', update);
      globalThis.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
