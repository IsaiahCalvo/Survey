const createRandomUUIDFallback = (cryptoObject) => () => {
  const bytes = new Uint8Array(16);

  if (typeof cryptoObject?.getRandomValues === 'function') {
    cryptoObject.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 version 4 UUID: set the version and variant bits explicitly.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
};

export const randomUUID = () => {
  const cryptoObject = globalThis?.crypto;
  if (typeof cryptoObject?.randomUUID === 'function') return cryptoObject.randomUUID();
  return createRandomUUIDFallback(cryptoObject)();
};

export const installRandomUUIDPolyfill = (target = globalThis) => {
  let cryptoObject = target?.crypto;

  if (!cryptoObject) {
    cryptoObject = {};
    try {
      Object.defineProperty(target, 'crypto', {
        configurable: true,
        value: cryptoObject,
      });
    } catch (_error) {
      return false;
    }
  }

  if (typeof cryptoObject.randomUUID === 'function') return true;

  try {
    Object.defineProperty(cryptoObject, 'randomUUID', {
      configurable: true,
      value: createRandomUUIDFallback(cryptoObject),
    });
  } catch (_error) {
    return false;
  }

  return typeof cryptoObject.randomUUID === 'function';
};

installRandomUUIDPolyfill();
