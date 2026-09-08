export function canRegisterBrowserOffline(window, production) {
  try {
    const nativeShell = new URLSearchParams(window?.location?.search || '').get('nativeShell') || window?.document?.documentElement?.dataset?.nativeShell;
    return !!(production && window?.isSecureContext && /^https?:$/.test(window.location?.protocol)
      && window.navigator?.serviceWorker && !window.electronAPI && !window.ReactNativeWebView
      && !['expo', 'capacitor'].includes(nativeShell)
      && !window.Capacitor?.isNativePlatform?.());
  } catch { return false; }
}

// Diagnostic state is deliberately not a promise that storage cannot be evicted.
// 'availableOffline' becomes true only after the worker checks its complete cache.
export async function registerBrowserOffline(window, { production, moduleUrl } = {}) {
  if (!canRegisterBrowserOffline(window, production)) return null;
  const publish = detail => {
    window.__surveyOfflineAssets = Object.freeze(detail);
    window.dispatchEvent(new window.CustomEvent('survey-offline-assets-status', { detail }));
  };
  publish({ status: 'installing', availableOffline: false });
  try {
    // Production Vite emits this module into assets/. Resolve from that module,
    // never from an OAuth URL or a nested SPA route. Native registration is off.
    const base = new URL('../', moduleUrl);
    const registration = await window.navigator.serviceWorker.register(new URL('sw.js', base).href, { scope: base.href, updateViaCache: 'none' });
    const inspected = new WeakSet();
    const inspect = worker => {
      if (!worker || inspected.has(worker)) return;
      inspected.add(worker);
      let pending = false;
      const query = (repair = false) => {
        if (pending) return;
        if (worker.state === 'redundant') {
          window.removeEventListener('online', onOnline);
          publish({ status: 'error', availableOffline: false, error: 'Offline app installation did not complete. Reconnect and reopen to retry.' });
          return;
        }
        if (!['installed', 'activated'].includes(worker.state)) return;
        pending = true;
        const channel = new window.MessageChannel();
        const timer = window.setTimeout(() => {
          pending = false; channel.port1.close();
          publish({ status: 'error', availableOffline: false, error: 'Offline app verification timed out.' });
        }, repair ? 150000 : 30000);
        channel.port1.onmessage = event => {
          pending = false; window.clearTimeout(timer); channel.port1.close();
          if (event.data?.type !== 'SURVEY_OFFLINE_STATUS') return;
          const availableOffline = event.data.availableOffline === true;
          if (!availableOffline && !repair && worker === registration.active && worker.state === 'activated') {
            publish({ status: 'repairing', availableOffline: false });
            query(true);
            return;
          }
          publish({ status: availableOffline ? (registration.waiting === worker && registration.active ? 'waiting' : 'ready') : 'error', availableOffline, version: event.data.version, totalBytes: event.data.totalBytes });
        };
        worker.postMessage({ type: repair ? 'SURVEY_OFFLINE_REPAIR' : 'SURVEY_OFFLINE_STATUS' }, [channel.port2]);
      };
      const onOnline = () => { if (worker === registration.active) query(); };
      worker.addEventListener('statechange', () => query());
      window.addEventListener('online', onOnline);
      query();
    };
    inspect(registration.active); inspect(registration.waiting); inspect(registration.installing);
    registration.addEventListener?.('updatefound', () => inspect(registration.installing));
    return registration;
  } catch (error) {
    publish({ status: 'error', availableOffline: false, error: error?.message || 'Offline app installation failed.' });
    return null;
  }
}
