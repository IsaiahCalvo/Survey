export const DEFAULT_IOS_SIMULATOR_DEV_SERVER_URL = 'http://127.0.0.1:5177/';

export function simulatorDevServerUrl(input = DEFAULT_IOS_SIMULATOR_DEV_SERVER_URL) {
  const url = new URL(String(input).trim());
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Simulator dev server must use http:// or https://.');
  }
  if (url.username || url.password) {
    throw new Error('Simulator dev server URL must not contain credentials.');
  }
  url.searchParams.set('mobileNav', 'tabs');
  url.searchParams.set('nativeShell', 'capacitor');
  return url.toString();
}

export function withSimulatorDevServer(config, serverUrl) {
  const url = new URL(serverUrl);
  return {
    ...config,
    server: {
      url: url.toString(),
      cleartext: url.protocol === 'http:',
    },
  };
}
