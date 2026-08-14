const path = require('path');

function packagedEntryPath(url, platform) {
  let pathname = decodeURIComponent(url.pathname || '');
  if (platform === 'win32' && /^\/[A-Za-z]:/.test(pathname)) pathname = pathname.slice(1);
  return path.resolve(pathname);
}

function isExpectedElectronAnalyticsEntry({ senderUrl, development, devPort, appPath, platform = process.platform }) {
  try {
    const url = new URL(senderUrl);
    if (development) {
      return url.protocol === 'http:'
        && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
        && url.port === String(devPort)
        && (url.pathname === '/' || url.pathname === '/index.html');
    }
    return url.protocol === 'file:'
      && !url.hostname
      && packagedEntryPath(url, platform) === path.resolve(appPath, 'dist', 'index.html');
  } catch {
    return false;
  }
}

function isTrustedElectronAnalyticsSender({
  senderWebContents,
  mainWebContents,
  senderUrl,
  development,
  devPort,
  appPath,
  platform,
}) {
  return Boolean(senderWebContents && senderWebContents === mainWebContents)
    && isExpectedElectronAnalyticsEntry({ senderUrl, development, devPort, appPath, platform });
}

module.exports = { isExpectedElectronAnalyticsEntry, isTrustedElectronAnalyticsSender };
