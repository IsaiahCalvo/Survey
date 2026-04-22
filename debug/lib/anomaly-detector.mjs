/**
 * Anomaly Detector
 *
 * Scans a merged timeline (from timeline-merger) for four locked anomaly types:
 * 1. Canvas container drop (canvasContainerCount === 0) -- critical
 * 2. Freeze overhang (freezeState stuck > 3000ms) -- critical
 * 3. Scale divergence (renderedScale != targetScale > 3000ms) -- warning
 * 4. Race condition (dom_pageAdded -> pal_mount gap) -- info/warning/critical
 *
 * Each anomaly includes: type, severity, sessionMs, page, detail, refs.
 */

const CONFIRM_PENDING_TIMEOUT_MS = 3000;
const RACE_WARNING_THRESHOLD_MS = 100;
const RACE_INFO_THRESHOLD_MS = 50;

/** Screenshot filename pattern: step-NN_MMMMMms_timing-description.png */
const SCREENSHOT_REGEX = /^step-(\d{2})_(\d+)ms_(.+)\.png$/;

/**
 * Parse a screenshot filename into structured data.
 * @param {string} filename
 * @returns {{ step: number, sessionMs: number, description: string } | null}
 */
function parseScreenshotName(filename) {
  const match = filename.match(SCREENSHOT_REGEX);
  if (!match) return null;
  return {
    step: Number(match[1]),
    sessionMs: Number(match[2]),
    description: match[3],
  };
}

/**
 * Find the screenshot filename closest to the given sessionMs.
 * @param {number} sessionMs
 * @param {Array<{ filename: string, sessionMs: number }>} screenshots
 * @returns {string | null}
 */
function findNearestScreenshot(sessionMs, screenshots) {
  if (screenshots.length === 0) return null;
  let nearest = screenshots[0];
  let minDelta = Math.abs(sessionMs - nearest.sessionMs);
  for (let i = 1; i < screenshots.length; i++) {
    const delta = Math.abs(sessionMs - screenshots[i].sessionMs);
    if (delta < minDelta) {
      minDelta = delta;
      nearest = screenshots[i];
    }
  }
  return nearest.filename;
}

/**
 * Build per-page event chains by correlating performance marks with DOM mutations.
 *
 * Performance marks (pal_mount, pal_unmount, fabric_renderEnd, etc.) come from
 * performance entries (_source='performance', type='mark').
 *
 * DOM mutations (dom_pageAdded, dom_pageRemoved) come from state entries
 * (_source='state', mutations array with type='added'|'removed').
 *
 * @param {Array<Object>} timeline - Merged timeline from mergeTimeline()
 * @returns {Object} Map of pageNumber -> array of { event, sessionMs, detail }
 */
function buildPageEventChains(timeline) {
  const chains = {};

  for (const entry of timeline) {
    // Performance marks with page detail
    if (entry._source === 'performance' && entry.type === 'mark') {
      const page = entry.detail?.page;
      if (page == null) continue;
      if (!chains[page]) chains[page] = [];
      chains[page].push({
        event: entry.name,
        sessionMs: entry.sessionMs,
        detail: entry.detail,
      });
    }

    // DOM mutations from state entries
    if (entry._source === 'state' && entry.mutations?.length > 0) {
      for (const mut of entry.mutations) {
        const page = mut.pageNumber;
        if (page == null) continue;
        if (!chains[page]) chains[page] = [];
        chains[page].push({
          event: `dom_page${mut.type === 'added' ? 'Added' : 'Removed'}`,
          sessionMs: mut.sessionMs,
          detail: mut,
        });
      }
    }
  }

  // Sort each page chain by sessionMs
  for (const page of Object.keys(chains)) {
    chains[page].sort((a, b) => a.sessionMs - b.sessionMs);
  }

  return chains;
}

/**
 * Detect canvas container drops (canvasContainerCount === 0).
 * Severity: always critical.
 */
function detectCanvasContainerDrop(stateEntries, screenshots) {
  const anomalies = [];
  for (const entry of stateEntries) {
    if (entry.canvasContainerCount === 0) {
      anomalies.push({
        type: 'canvas_container_drop',
        severity: 'critical',
        sessionMs: entry.sessionMs,
        page: null,
        detail: `Canvas container count dropped to 0 at step ${entry.step} (${entry.action})`,
        refs: {
          stateIndex: entry._index,
          screenshot: findNearestScreenshot(entry.sessionMs, screenshots),
        },
      });
    }
  }
  return anomalies;
}

/**
 * Detect freeze overhang (freezeState stuck beyond 3000ms between consecutive state entries).
 * Severity: always critical.
 */
function detectFreezeOverhang(stateEntries, screenshots) {
  const anomalies = [];
  for (let i = 0; i < stateEntries.length - 1; i++) {
    const prev = stateEntries[i];
    const next = stateEntries[i + 1];
    const isFrozen =
      prev.freezeState?.scaleConfirmPending === true ||
      prev.freezeState?.zoomOverlayTransformActive === true;

    if (isFrozen) {
      const duration = next.sessionMs - prev.sessionMs;
      if (duration > CONFIRM_PENDING_TIMEOUT_MS) {
        anomalies.push({
          type: 'freeze_overhang',
          severity: 'critical',
          sessionMs: prev.sessionMs,
          page: null,
          detail: `Freeze state stuck for ${Math.round(duration)}ms (> ${CONFIRM_PENDING_TIMEOUT_MS}ms threshold) between step ${prev.step} and step ${next.step}`,
          refs: {
            stateIndex: prev._index,
            screenshot: findNearestScreenshot(prev.sessionMs, screenshots),
          },
        });
      }
    }
  }
  return anomalies;
}

/**
 * Detect scale divergence (renderedScale != targetScale persisting beyond 3000ms).
 * Severity: always warning.
 */
function detectScaleDivergence(stateEntries, screenshots) {
  const anomalies = [];
  for (let i = 0; i < stateEntries.length - 1; i++) {
    const prev = stateEntries[i];
    const next = stateEntries[i + 1];

    if (
      prev.renderedScale != null &&
      prev.targetScale != null &&
      prev.renderedScale !== prev.targetScale
    ) {
      const duration = next.sessionMs - prev.sessionMs;
      if (duration > CONFIRM_PENDING_TIMEOUT_MS) {
        anomalies.push({
          type: 'scale_divergence',
          severity: 'warning',
          sessionMs: prev.sessionMs,
          page: null,
          detail: `renderedScale (${prev.renderedScale}) != targetScale (${prev.targetScale}) persisted for ${Math.round(duration)}ms at step ${prev.step}`,
          refs: {
            stateIndex: prev._index,
            screenshot: findNearestScreenshot(prev.sessionMs, screenshots),
          },
        });
      }
    }
  }
  return anomalies;
}

/**
 * Detect race conditions (dom_pageAdded -> pal_mount gap).
 * Severity: info (50-100ms), warning (>100ms), critical (>100ms + screenshot in gap).
 */
function detectRaceConditions(pageChains, screenshots) {
  const anomalies = [];

  for (const [pageNum, events] of Object.entries(pageChains)) {
    for (let i = 0; i < events.length; i++) {
      if (events[i].event !== 'dom_pageAdded') continue;

      // Find next pal_mount for this page after this dom_pageAdded
      const mountEvent = events.slice(i + 1).find(e => e.event === 'pal_mount');
      if (!mountEvent) continue;

      const delta = mountEvent.sessionMs - events[i].sessionMs;
      if (delta < RACE_INFO_THRESHOLD_MS) continue;

      // Check if any screenshot falls within the gap
      const gapStart = events[i].sessionMs;
      const gapEnd = mountEvent.sessionMs;
      const screenshotInGap = screenshots.find(
        s => s.sessionMs >= gapStart && s.sessionMs <= gapEnd
      );

      const severity = screenshotInGap
        ? 'critical'
        : delta > RACE_WARNING_THRESHOLD_MS
          ? 'warning'
          : 'info';

      anomalies.push({
        type: 'race_condition',
        severity,
        sessionMs: events[i].sessionMs,
        page: Number(pageNum),
        detail: `${Math.round(delta)}ms gap between DOM page added and PAL mount on page ${pageNum}${screenshotInGap ? ` (screenshot ${screenshotInGap.filename} captured during gap)` : ''}`,
        refs: {
          stateIndex: null,
          screenshot: screenshotInGap?.filename ||
            findNearestScreenshot(events[i].sessionMs, screenshots),
        },
      });
    }
  }

  return anomalies;
}

/**
 * Detect anomalies in a merged timeline.
 *
 * @param {Array<Object>} timeline - Merged timeline from mergeTimeline() with _source and _index tags
 * @param {Object} manifest - Session manifest with scenario metadata and artifacts
 * @returns {Array<Object>} Array of anomaly objects sorted by sessionMs
 */
export function detectAnomalies(timeline, manifest) {
  // Parse screenshot filenames from manifest artifacts
  // Support both 'filename' (test fixtures) and 'path' (real session data) fields
  const screenshots = (manifest.artifacts || [])
    .filter(a => a.type === 'screenshot')
    .map(a => {
      const fname = a.filename || a.path;
      if (!fname) return null;
      const parsed = parseScreenshotName(fname);
      return parsed ? { filename: fname, ...parsed } : null;
    })
    .filter(Boolean);

  // Extract state entries for rules that scan consecutive state pairs
  const stateEntries = timeline.filter(e => e._source === 'state');

  // Build per-page event chains for race condition detection
  const pageChains = buildPageEventChains(timeline);

  // Run all four detection rules
  const anomalies = [
    ...detectCanvasContainerDrop(stateEntries, screenshots),
    ...detectFreezeOverhang(stateEntries, screenshots),
    ...detectScaleDivergence(stateEntries, screenshots),
    ...detectRaceConditions(pageChains, screenshots),
  ];

  // Sort all anomalies by sessionMs
  anomalies.sort((a, b) => a.sessionMs - b.sessionMs);

  return anomalies;
}
