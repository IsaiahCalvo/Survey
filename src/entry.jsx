async function installDevReactScanIfRequested() {
  if (!import.meta.env.DEV) return;

  const reactScanParam = new URLSearchParams(window.location.search).get('reactScan');
  if (reactScanParam === '0') {
    window.localStorage.removeItem('reactScan');
  }
  if (reactScanParam === '1') {
    window.localStorage.setItem('reactScan', '1');
  }

  const reactScanEnabled = reactScanParam === '1' || window.localStorage.getItem('reactScan') === '1';
  if (!reactScanEnabled) return;

  const { installReactScan } = await import('./dev/reactScanBootstrap.js');
  installReactScan();
}

installDevReactScanIfRequested()
  .catch((error) => {
    console.warn('[ReactScan] dev bootstrap failed', error);
  })
  .finally(() => {
    import('./main.jsx');
  });
