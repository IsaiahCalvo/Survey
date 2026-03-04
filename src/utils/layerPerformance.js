/**
 * Layer Performance Utilities
 *
 * CSS and DOM optimizations for high-performance multi-layer rendering.
 * Based on Adobe Acrobat's architecture and modern browser optimizations.
 */

/**
 * CSS styles for the PDF base layer (static content)
 * This layer rarely changes and should be heavily optimized for compositor
 */
export const PDF_LAYER_STYLES = {
  // Isolation
  isolation: 'isolate',

  // Containment - tells browser this layer's layout doesn't affect others
  contain: 'layout style paint',

  // Content visibility - browser can skip rendering work when off-screen
  contentVisibility: 'auto',

  // Rendering hints
  imageRendering: 'auto',

  // Transform optimization (enables GPU acceleration)
  transform: 'translateZ(0)',
  willChange: 'auto', // Don't hint will-change for static layer

  // Prevent subpixel antialiasing issues
  WebkitFontSmoothing: 'subpixel-antialiased',
  MozOsxFontSmoothing: 'grayscale',
};

/**
 * CSS styles for the text selection layer
 * Lightweight SVG/HTML layer for text selection
 */
export const TEXT_LAYER_STYLES = {
  // Position on top of PDF
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,

  // Isolation
  isolation: 'isolate',

  // Containment
  contain: 'layout style',

  // Pointer events
  pointerEvents: 'auto',

  // Transform for GPU
  transform: 'translateZ(0)',
  willChange: 'auto',

  // Allow selection
  userSelect: 'text',
  WebkitUserSelect: 'text',
};

/**
 * CSS styles for the annotation canvas layer
 * This layer changes frequently and needs special optimization
 */
export const ANNOTATION_LAYER_STYLES = {
  // Position on top of everything
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,

  // Isolation - CRITICAL for preventing repaints of lower layers
  isolation: 'isolate',

  // Containment - annotation changes don't trigger layout in other layers
  contain: 'layout style paint',

  // Content visibility
  contentVisibility: 'auto',

  // Transform optimization
  transform: 'translateZ(0)',

  // Will-change for frequently changing content
  // Only use when actively editing/scrolling
  willChange: 'transform, opacity',

  // Backface visibility
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',

  // Rendering hints
  imageRendering: 'auto',

  // Smooth rendering
  WebkitFontSmoothing: 'antialiased',
  MozOsxFontSmoothing: 'grayscale',
};

/**
 * Styles for annotation layer during interaction (dragging, resizing, etc.)
 */
export const ANNOTATION_LAYER_INTERACTIVE_STYLES = {
  ...ANNOTATION_LAYER_STYLES,

  // Enhanced GPU acceleration during interaction
  willChange: 'transform, opacity, left, top, width, height',

  // Disable pointer events on lower layers during drag for performance
  pointerEvents: 'auto',
};

/**
 * Styles for page container (holds all layers)
 */
export const PAGE_CONTAINER_STYLES = {
  position: 'relative',

  // Isolation - each page is independent rendering context
  isolation: 'isolate',

  // Containment - page layout doesn't affect other pages
  contain: 'layout style paint',

  // Content visibility - browser can skip rendering off-screen pages
  contentVisibility: 'auto',

  // Transform for hardware acceleration
  transform: 'translateZ(0)',
  willChange: 'auto',
};

/**
 * Apply performance optimizations to a canvas element
 */
export function optimizeCanvas(canvas, options = {}) {
  const {
    isStatic = false,        // Is this a static layer (PDF) or dynamic (annotations)?
    enableGPU = true,        // Enable GPU acceleration
    highDPI = true,          // Support high-DPI displays
  } = options;

  if (!canvas) return;

  // Canvas-specific attributes
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';

  // GPU acceleration
  if (enableGPU) {
    canvas.style.transform = 'translateZ(0)';
    canvas.style.backfaceVisibility = 'hidden';
    canvas.style.willChange = isStatic ? 'auto' : 'transform';
  }

  // High-DPI support
  if (highDPI) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // Image rendering
  canvas.style.imageRendering = 'auto';

  return canvas;
}

/**
 * Create a performance-optimized layer container
 */
export function createLayerContainer(type = 'pdf') {
  const container = document.createElement('div');

  let styles;
  switch (type) {
    case 'pdf':
      styles = PDF_LAYER_STYLES;
      break;
    case 'text':
      styles = TEXT_LAYER_STYLES;
      break;
    case 'annotation':
      styles = ANNOTATION_LAYER_STYLES;
      break;
    case 'page':
      styles = PAGE_CONTAINER_STYLES;
      break;
    default:
      styles = {};
  }

  Object.assign(container.style, styles);

  return container;
}

/**
 * Enable high-performance mode during scrolling/interaction
 * Call this when user starts scrolling, disable when idle
 */
export function setHighPerformanceMode(element, enabled = true) {
  if (!element) return;

  if (enabled) {
    // Aggressive GPU hints during interaction
    element.style.willChange = 'transform, opacity';
    element.style.transform = 'translateZ(0)';
    element.style.backfaceVisibility = 'hidden';
  } else {
    // Remove hints when idle to save GPU memory
    element.style.willChange = 'auto';
  }
}

/**
 * Batch DOM updates for better performance
 * Use this when making multiple style changes
 */
export function batchDOMUpdates(callback) {
  requestAnimationFrame(() => {
    callback();
  });
}

/**
 * Debounce function for scroll/resize handlers
 */
export function debounce(func, wait = 16) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function for high-frequency events
 */
export function throttle(func, limit = 16) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Check if an element is in viewport (for lazy rendering)
 */
export function isInViewport(element, offset = 0) {
  if (!element) return false;

  const rect = element.getBoundingClientRect();
  const windowHeight = window.innerHeight || document.documentElement.clientHeight;
  const windowWidth = window.innerWidth || document.documentElement.clientWidth;

  return (
    rect.top < windowHeight + offset &&
    rect.bottom > -offset &&
    rect.left < windowWidth + offset &&
    rect.right > -offset
  );
}

/**
 * Request idle callback with fallback
 */
export function requestIdleCallbackPolyfill(callback, options = {}) {
  if (typeof requestIdleCallback !== 'undefined') {
    return requestIdleCallback(callback, options);
  }

  // Fallback for browsers without requestIdleCallback
  const timeout = options.timeout || 50;
  return setTimeout(() => {
    callback({
      didTimeout: false,
      timeRemaining: () => Math.max(0, timeout - (Date.now() - start)),
    });
  }, 1);
}

export function cancelIdleCallbackPolyfill(id) {
  if (typeof cancelIdleCallback !== 'undefined') {
    return cancelIdleCallback(id);
  }
  return clearTimeout(id);
}
