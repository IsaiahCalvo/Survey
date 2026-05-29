/**
 * reportWebVitals.js — Create React App web-vitals reporting shim.
 *
 * Default-exports reportWebVitals(onPerfEntry): when passed a callback, lazily
 * imports web-vitals and forwards CLS/FID/FCP/LCP/TTFB metrics to it. Standard
 * CRA boilerplate; a no-op unless a handler is supplied.
 */
const reportWebVitals = onPerfEntry => {
  if (onPerfEntry && onPerfEntry instanceof Function) {
    import('web-vitals').then(({ getCLS, getFID, getFCP, getLCP, getTTFB }) => {
      getCLS(onPerfEntry);
      getFID(onPerfEntry);
      getFCP(onPerfEntry);
      getLCP(onPerfEntry);
      getTTFB(onPerfEntry);
    });
  }
};

export default reportWebVitals;
