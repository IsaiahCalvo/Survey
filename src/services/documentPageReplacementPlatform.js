import { createDocumentPageReplacementTransport }
  from './documentPageReplacementTransport.js';

const WEB_ORIGINS = new Set([
  'https://surveytool.app',
  'https://www.surveytool.app',
]);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const plain = value => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype;

function optionDescriptors(value) {
  if (!plain(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string'
    || !['fetch', 'injectedTransport', 'window'].includes(key))) return null;
  return descriptors;
}

function dataValue(descriptors, key) {
  const descriptor = descriptors[key];
  if (!descriptor) return undefined;
  if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError();
  return descriptor.value;
}

function locationUrl(view) {
  const location = view?.location;
  return new URL(location?.href ?? location?.origin);
}

function isLoopbackDevelopment(url) {
  return (url.protocol === 'http:' || url.protocol === 'https:')
    && LOOPBACK_HOSTS.has(url.hostname) && url.port !== '';
}

function isLocalCapacitorUrl(url) {
  if (url.hostname !== 'localhost') return false;
  return url.protocol === 'capacitor:'
    || ((url.protocol === 'http:' || url.protocol === 'https:') && url.port === '');
}

/** Selects one of two fixed request targets for a known app runtime. Unknown
 * browser scopes fail closed. A host-provided transport always has precedence. */
export function resolveDocumentPageReplacementTransport(options = {}) {
  const descriptors = optionDescriptors(options);
  if (!descriptors) return null;

  const injectedDescriptor = descriptors.injectedTransport;
  if (injectedDescriptor?.enumerable && Object.hasOwn(injectedDescriptor, 'value')
    && typeof injectedDescriptor.value === 'function') return injectedDescriptor.value;

  try {
    const view = Object.hasOwn(descriptors, 'window')
      ? dataValue(descriptors, 'window') : globalThis.window;
    const fetch = dataValue(descriptors, 'fetch');
    if (!view) return null;
    const url = locationUrl(view);
    if (WEB_ORIGINS.has(url.origin) || isLoopbackDevelopment(url)) {
      return createDocumentPageReplacementTransport({ fetch, target: 'same-origin' });
    }
    if (view.electronAPI && url.protocol === 'file:') {
      return createDocumentPageReplacementTransport({ fetch, target: 'trusted-app-host' });
    }
    const capacitor = view.Capacitor;
    if (typeof capacitor?.isNativePlatform === 'function'
      && capacitor.isNativePlatform() === true && isLocalCapacitorUrl(url)) {
      return createDocumentPageReplacementTransport({ fetch, target: 'trusted-app-host' });
    }
  } catch {
    return null;
  }
  return null;
}
