import { scan } from 'react-scan';

export function installReactScan() {
  scan({
    enabled: true,
    showToolbar: true,
    showFPS: true,
    animationSpeed: 'fast',
    log: false,
  });

  window.__reactScanEnabled = true;
  console.info('[ReactScan] enabled. Disable with ?reactScan=0.');
}
