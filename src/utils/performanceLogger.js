/**
 * Performance Logger for PDF Operations
 * Tracks timing for upload, load, render, zoom, and scroll operations
 */

const DEBUG_ENABLED = true; // Set to false to disable all logging

class PerformanceLogger {
  constructor() {
    this.timers = new Map();
    this.metrics = {
      uploads: [],
      loads: [],
      renders: [],
      zooms: [],
      scrollRenders: [],
    };
  }

  // Start a timer
  start(label) {
    if (!DEBUG_ENABLED) return;
    this.timers.set(label, {
      start: performance.now(),
      marks: []
    });
  }

  // Add an intermediate mark
  mark(label, markName) {
    if (!DEBUG_ENABLED) return;
    const timer = this.timers.get(label);
    if (timer) {
      timer.marks.push({
        name: markName,
        time: performance.now() - timer.start
      });
    }
  }

  // End timer and log results
  end(label, category = null) {
    if (!DEBUG_ENABLED) return null;

    const timer = this.timers.get(label);
    if (!timer) return null;

    const duration = performance.now() - timer.start;
    const result = {
      label,
      duration,
      marks: timer.marks,
      timestamp: new Date().toISOString()
    };

    // Store in metrics by category
    if (category && this.metrics[category]) {
      this.metrics[category].push(result);
    }

    // Log to console with styling
    this.logResult(result);

    this.timers.delete(label);
    return duration;
  }

  logResult(result) {
    const { label, duration, marks } = result;

    // Color code based on duration
    let color = '#4CAF50'; // green < 500ms
    if (duration > 2000) color = '#f44336'; // red > 2s
    else if (duration > 500) color = '#ff9800'; // orange > 500ms

    console.log(
      `%c[PERF] ${label}: ${duration.toFixed(2)}ms`,
      `color: ${color}; font-weight: bold;`
    );

    // Log marks if any
    if (marks.length > 0) {
      console.log('%c  Breakdown:', 'color: #888;');
      marks.forEach((mark, i) => {
        const prevTime = i > 0 ? marks[i - 1].time : 0;
        const delta = mark.time - prevTime;
        console.log(`%c    → ${mark.name}: +${delta.toFixed(2)}ms (at ${mark.time.toFixed(2)}ms)`, 'color: #888;');
      });
    }
  }

  // Get summary statistics
  getSummary() {
    const summarize = (arr) => {
      if (arr.length === 0) return null;
      const durations = arr.map(m => m.duration);
      return {
        count: arr.length,
        avg: durations.reduce((a, b) => a + b, 0) / arr.length,
        min: Math.min(...durations),
        max: Math.max(...durations),
        last: durations[durations.length - 1]
      };
    };

    return {
      uploads: summarize(this.metrics.uploads),
      loads: summarize(this.metrics.loads),
      renders: summarize(this.metrics.renders),
      zooms: summarize(this.metrics.zooms),
      scrollRenders: summarize(this.metrics.scrollRenders),
    };
  }

  // Print summary to console
  printSummary() {
    if (!DEBUG_ENABLED) return;

    console.log('%c\n=== PDF Performance Summary ===', 'color: #2196F3; font-weight: bold; font-size: 14px;');

    const summary = this.getSummary();

    Object.entries(summary).forEach(([category, stats]) => {
      if (stats) {
        console.log(`%c${category}:`, 'color: #9C27B0; font-weight: bold;');
        console.log(`  Count: ${stats.count}`);
        console.log(`  Avg: ${stats.avg.toFixed(2)}ms`);
        console.log(`  Min: ${stats.min.toFixed(2)}ms`);
        console.log(`  Max: ${stats.max.toFixed(2)}ms`);
      }
    });
  }

  // Clear all metrics
  clear() {
    this.timers.clear();
    Object.keys(this.metrics).forEach(key => {
      this.metrics[key] = [];
    });
  }
}

// Singleton instance
export const perfLogger = new PerformanceLogger();

// Convenience functions for specific operations
export const perfUpload = {
  start: (fileName) => perfLogger.start(`Upload: ${fileName}`),
  mark: (fileName, markName) => perfLogger.mark(`Upload: ${fileName}`, markName),
  end: (fileName) => perfLogger.end(`Upload: ${fileName}`, 'uploads'),
};

export const perfLoad = {
  start: (docName) => perfLogger.start(`Load PDF: ${docName}`),
  mark: (docName, markName) => perfLogger.mark(`Load PDF: ${docName}`, markName),
  end: (docName) => perfLogger.end(`Load PDF: ${docName}`, 'loads'),
};

export const perfRender = {
  start: (pageNum) => perfLogger.start(`Render Page ${pageNum}`),
  mark: (pageNum, markName) => perfLogger.mark(`Render Page ${pageNum}`, markName),
  end: (pageNum) => perfLogger.end(`Render Page ${pageNum}`, 'renders'),
};

export const perfZoom = {
  start: (scale) => perfLogger.start(`Zoom to ${scale}x`),
  mark: (scale, markName) => perfLogger.mark(`Zoom to ${scale}x`, markName),
  end: (scale) => perfLogger.end(`Zoom to ${scale}x`, 'zooms'),
};

export const perfScroll = {
  start: (pageNum) => perfLogger.start(`Scroll Render Page ${pageNum}`),
  end: (pageNum) => perfLogger.end(`Scroll Render Page ${pageNum}`, 'scrollRenders'),
};

// Expose to window for debugging in console
if (typeof window !== 'undefined') {
  window.pdfPerf = perfLogger;
  console.log('%c[PERF] Performance logger initialized. Use window.pdfPerf.printSummary() to see stats.', 'color: #2196F3;');
}

export default perfLogger;
