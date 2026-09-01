const DEFAULT_PRINT_IMAGE_TIMEOUT_MS = 30_000;

export const createPrintPageError = (pageNumber, reason) => {
  const detail = reason ? `: ${reason}` : '';
  const error = new Error(`Could not prepare page ${pageNumber} for print${detail}.`);
  error.printPageNumber = pageNumber;
  return error;
};

export const waitForPrintImage = (image, pageNumber, options = {}) => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PRINT_IMAGE_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    let decoding = false;
    let timer = null;
    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      image.removeEventListener('load', handleLoad);
      image.removeEventListener('error', handleError);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const fail = (reason) => finish(reject, createPrintPageError(pageNumber, reason));
    const decode = async () => {
      if (decoding || settled) return;
      decoding = true;
      if (image.naturalWidth < 1 || image.naturalHeight < 1) {
        fail('the page image is blank');
        return;
      }
      try {
        if (typeof image.decode === 'function') await image.decode();
        if (image.naturalWidth < 1 || image.naturalHeight < 1) {
          fail('the page image is blank');
          return;
        }
        finish(resolve);
      } catch (error) {
        fail(error?.message || 'the page image could not be decoded');
      }
    };
    function handleLoad() { void decode(); }
    function handleError() { fail('the page image could not be loaded'); }

    image.addEventListener('load', handleLoad, { once: true });
    image.addEventListener('error', handleError, { once: true });
    timer = setTimeout(() => fail('the page image timed out'), timeoutMs);
    if (image.complete) void decode();
  });
};

export const waitForPrintImages = (images, pageNumbers, options = {}) => {
  const expectedPages = Array.isArray(pageNumbers) ? pageNumbers : [];
  if (images.length !== expectedPages.length) {
    const missingIndex = Math.min(images.length, Math.max(0, expectedPages.length - 1));
    const missingPage = expectedPages[missingIndex] ?? expectedPages[0] ?? 1;
    return Promise.reject(createPrintPageError(missingPage, 'the page image is missing'));
  }
  return Promise.all(images.map((image, index) => (
    waitForPrintImage(image, expectedPages[index], options)
  )));
};
