/**
 * Timeline Narrative Writer
 *
 * Generates a human/LLM-readable markdown narrative from a merged timeline,
 * anomaly list, and session manifest. Designed to feed Phase 9 LLM consumption.
 *
 * Structure:
 * 1. Session summary header (scenario, result, duration, anomaly counts, verdict)
 * 2. Per-step sections (grouped by CaptureContext step numbers)
 * 3. Inline anomaly callouts within step sections
 * 4. CDP metrics as step-boundary deltas (when exceeding thresholds)
 * 5. Visual diff references (when mismatch > 1%)
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseScreenshotName } from './visual-diff.mjs';

/** CDP metric thresholds -- only display deltas exceeding these */
const CDP_THRESHOLDS = {
  LayoutCount: 20,
  TaskDuration: 0.1, // 100ms in seconds
};

/**
 * Generate a markdown narrative from post-processing data.
 *
 * @param {Array<Object>} timeline - Merged timeline from mergeTimeline()
 * @param {Array<Object>} anomalies - Anomaly list from detectAnomalies()
 * @param {Object} manifest - Session manifest
 * @param {string} sessionDir - Path to session directory (for reading diffs/summary.json)
 * @returns {string} Markdown narrative string
 */
export function writeNarrative(timeline, anomalies, manifest, sessionDir) {
  const lines = [];

  // Load diffs summary if available
  let diffsSummary = [];
  const diffsSummaryPath = join(sessionDir, 'diffs', 'summary.json');
  if (existsSync(diffsSummaryPath)) {
    try {
      diffsSummary = JSON.parse(readFileSync(diffsSummaryPath, 'utf-8'));
    } catch {
      // Ignore parse errors
    }
  }

  // --- Session Summary Header ---
  lines.push(generateHeader(manifest, anomalies));

  // --- Per-step sections ---
  const steps = groupByStep(timeline, manifest);
  const stepNumbers = Object.keys(steps).map(Number).sort((a, b) => a - b);

  for (const stepNum of stepNumbers) {
    const step = steps[stepNum];
    lines.push(generateStepSection(stepNum, step, anomalies, diffsSummary));
  }

  return lines.join('\n\n');
}

/**
 * Generate session summary header.
 */
function generateHeader(manifest, anomalies) {
  const duration = calculateDuration(manifest);
  const counts = countBySeverity(anomalies);
  const verdict = generateVerdict(counts);

  const lines = [
    `# Session Report: ${manifest.scenario}`,
    '',
    `**Result:** ${manifest.result.toUpperCase()} | **Duration:** ${duration}ms | **Anomalies:** ${counts.critical} critical, ${counts.warning} warning, ${counts.info} info`,
    '',
    verdict,
  ];

  return lines.join('\n');
}

/**
 * Calculate session duration in milliseconds.
 */
function calculateDuration(manifest) {
  if (manifest.startTime && manifest.endTime) {
    return new Date(manifest.endTime) - new Date(manifest.startTime);
  }
  return 0;
}

/**
 * Count anomalies by severity.
 */
function countBySeverity(anomalies) {
  const counts = { critical: 0, warning: 0, info: 0 };
  for (const a of anomalies) {
    if (counts[a.severity] !== undefined) {
      counts[a.severity]++;
    }
  }
  return counts;
}

/**
 * Generate verdict text based on anomaly severity.
 */
function generateVerdict(counts) {
  if (counts.critical > 0) {
    return 'Session contains critical anomalies requiring investigation.';
  }
  if (counts.warning > 0) {
    return 'Session completed with warnings -- review recommended.';
  }
  return 'Session completed cleanly with no anomalies detected.';
}

/**
 * Group timeline entries by step number.
 *
 * State entries have a `step` field. Performance and console entries are
 * assigned to the step whose time range they fall within.
 *
 * Returns: { [stepNum]: { entries, startMs, endMs, stateEntries, perfEntries, consoleEntries } }
 */
function groupByStep(timeline, manifest) {
  // Find all unique steps from state entries
  const stateEntries = timeline.filter(e => e._source === 'state');
  const stepBoundaries = [];

  const stepNums = [...new Set(stateEntries.map(e => e.step).filter(s => s != null))].sort((a, b) => a - b);

  for (const stepNum of stepNums) {
    const stepStates = stateEntries.filter(e => e.step === stepNum);
    const startMs = Math.min(...stepStates.map(e => e.sessionMs));
    stepBoundaries.push({ step: stepNum, startMs });
  }

  // Build step groups with time ranges
  const steps = {};
  for (let i = 0; i < stepBoundaries.length; i++) {
    const boundary = stepBoundaries[i];
    const nextBoundary = stepBoundaries[i + 1];
    const endMs = nextBoundary ? nextBoundary.startMs : Infinity;

    steps[boundary.step] = {
      startMs: boundary.startMs,
      endMs,
      entries: [],
      stateEntries: [],
      perfEntries: [],
      consoleEntries: [],
    };
  }

  // Assign all entries to steps based on time range
  for (const entry of timeline) {
    // State entries go to their declared step
    if (entry._source === 'state' && entry.step != null && steps[entry.step]) {
      steps[entry.step].entries.push(entry);
      steps[entry.step].stateEntries.push(entry);
      continue;
    }

    // Performance/console entries assigned by time range
    for (const stepNum of stepNums) {
      const step = steps[stepNum];
      if (entry.sessionMs >= step.startMs && entry.sessionMs < step.endMs) {
        step.entries.push(entry);
        if (entry._source === 'performance') {
          step.perfEntries.push(entry);
        } else if (entry._source === 'console') {
          step.consoleEntries.push(entry);
        }
        break;
      }
    }
  }

  return steps;
}

/**
 * Generate a step section with heading, summary, events, anomaly callouts, and CDP deltas.
 */
function generateStepSection(stepNum, step, anomalies, diffsSummary) {
  const actualEndMs = step.endMs === Infinity
    ? Math.max(...step.entries.map(e => e.sessionMs))
    : step.endMs;
  const duration = actualEndMs - step.startMs;

  // Determine action description from state entries
  const action = step.stateEntries[0]?.action || 'unknown';

  const lines = [
    `## Step ${stepNum}: ${action} (${step.startMs}ms - ${actualEndMs}ms, ${duration}ms)`,
  ];

  // Synthesized summary
  const summary = synthesizeSummary(step);
  if (summary) {
    lines.push('', summary);
  }

  // Key events
  const events = generateKeyEvents(step);
  if (events) {
    lines.push('', events);
  }

  // Noise-collapsed DOM mutations
  const mutations = collapseMutations(step);
  if (mutations) {
    lines.push('', mutations);
  }

  // Anomaly callouts inline
  const stepAnomalies = anomalies.filter(
    a => a.sessionMs >= step.startMs && a.sessionMs < (step.endMs === Infinity ? Infinity : step.endMs)
  );
  for (const anomaly of stepAnomalies) {
    const screenshotRef = anomaly.refs?.screenshot ? ` (see ${anomaly.refs.screenshot})` : '';
    lines.push('', `> **${anomaly.severity.toUpperCase()}** ${anomaly.type}: ${anomaly.detail}${screenshotRef}`);
  }

  // CDP metrics as step-boundary deltas
  const cdpDelta = generateCdpDeltas(step);
  if (cdpDelta) {
    lines.push('', cdpDelta);
  }

  // Visual diff references
  const diffRef = generateDiffReference(stepNum, diffsSummary);
  if (diffRef) {
    lines.push('', diffRef);
  }

  return lines.join('\n');
}

/**
 * Synthesize a plain-English summary of what happened in the step.
 */
function synthesizeSummary(step) {
  const firstState = step.stateEntries[0];
  const lastState = step.stateEntries[step.stateEntries.length - 1];
  if (!firstState) return null;

  const parts = [];

  // Zoom changes
  if (firstState.zoomLevel != null && lastState && lastState.zoomLevel !== firstState.zoomLevel) {
    parts.push(`Zoomed from ${firstState.zoomLevel}% to ${lastState.zoomLevel}%`);
  } else if (firstState.action === 'baseline') {
    parts.push(`Baseline state captured at ${firstState.zoomLevel || 'default'}% zoom`);
  } else if (firstState.zoomLevel != null) {
    parts.push(`Zoom at ${firstState.zoomLevel}%`);
  }

  // Scale reconciliation
  if (firstState.renderedScale !== firstState.targetScale && lastState &&
      lastState.renderedScale === lastState.targetScale) {
    parts.push('Scale reconciled');
  }

  // Freeze state changes
  const wasFreeze = firstState.freezeState?.scaleConfirmPending ||
                    firstState.freezeState?.zoomOverlayTransformActive;
  const isFreeze = lastState?.freezeState?.scaleConfirmPending ||
                   lastState?.freezeState?.zoomOverlayTransformActive;
  if (wasFreeze && !isFreeze) {
    parts.push('Freeze released');
  } else if (!wasFreeze && isFreeze) {
    parts.push('Freeze engaged');
  }

  return parts.length > 0 ? parts.join('. ') + '.' : null;
}

/**
 * Generate key event bullet points with timestamps.
 */
function generateKeyEvents(step) {
  const events = [];

  // Performance marks
  for (const perf of step.perfEntries) {
    if (perf.type === 'mark') {
      const detail = perf.detail ? ` (${JSON.stringify(perf.detail)})` : '';
      events.push(`- **${perf.sessionMs}ms** ${perf.name}${detail}`);
    }
  }

  // Console entries (errors/warnings only)
  for (const con of step.consoleEntries) {
    if (con.level === 'error' || con.level === 'warning') {
      events.push(`- **${con.sessionMs}ms** [${con.level.toUpperCase()}] ${con.text}`);
    }
  }

  return events.length > 0 ? events.join('\n') : null;
}

/**
 * Collapse rapid DOM mutations for the same page (noise reduction).
 *
 * If > 3 mutations for the same page within a step, summarize as count + time span
 * instead of listing each one.
 */
function collapseMutations(step) {
  // Gather all mutations from state entries in this step
  const pageMutations = {};

  for (const state of step.stateEntries) {
    if (!state.mutations?.length) continue;
    for (const mut of state.mutations) {
      const page = mut.pageNumber;
      if (page == null) continue;
      if (!pageMutations[page]) pageMutations[page] = [];
      pageMutations[page].push(mut);
    }
  }

  const lines = [];

  for (const [page, muts] of Object.entries(pageMutations)) {
    if (muts.length > 3) {
      // Noise collapse: summarize
      const times = muts.map(m => m.sessionMs).filter(Boolean);
      const span = times.length >= 2
        ? `${Math.max(...times) - Math.min(...times)}ms`
        : 'instant';
      lines.push(`- Page ${page} mutated ${muts.length} times over ${span}`);
    } else {
      // List individually
      for (const mut of muts) {
        const ts = mut.sessionMs ? ` at ${mut.sessionMs}ms` : '';
        lines.push(`- Page ${page} ${mut.type}${ts}`);
      }
    }
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Generate CDP metric deltas between step boundaries.
 *
 * Only display when LayoutCount delta > 20 OR TaskDuration delta > 0.1 (100ms).
 */
function generateCdpDeltas(step) {
  const cdpEntries = step.perfEntries.filter(e => e.type === 'cdp');
  if (cdpEntries.length < 2) return null;

  const first = cdpEntries[0];
  const last = cdpEntries[cdpEntries.length - 1];

  if (!first.metrics || !last.metrics) return null;

  const deltas = {};
  const metricsToTrack = ['LayoutCount', 'TaskDuration', 'RecalcStyleCount'];

  for (const metric of metricsToTrack) {
    if (first.metrics[metric] != null && last.metrics[metric] != null) {
      deltas[metric] = last.metrics[metric] - first.metrics[metric];
    }
  }

  // Check thresholds
  const layoutExceeds = (deltas.LayoutCount || 0) > CDP_THRESHOLDS.LayoutCount;
  const taskExceeds = (deltas.TaskDuration || 0) > CDP_THRESHOLDS.TaskDuration;

  if (!layoutExceeds && !taskExceeds) return null;

  const parts = [];
  if (deltas.LayoutCount != null) parts.push(`LayoutCount: +${deltas.LayoutCount}`);
  if (deltas.TaskDuration != null) parts.push(`TaskDuration: +${(deltas.TaskDuration * 1000).toFixed(0)}ms`);
  if (deltas.RecalcStyleCount != null) parts.push(`RecalcStyleCount: +${deltas.RecalcStyleCount}`);

  return `**CDP Deltas:** ${parts.join(' | ')}`;
}

/**
 * Generate visual diff reference for a step if mismatch > 1%.
 */
function generateDiffReference(stepNum, diffsSummary) {
  if (!diffsSummary || diffsSummary.length === 0) return null;

  const diff = diffsSummary.find(d => d.step === stepNum);
  if (!diff || diff.error) return null;
  if (diff.mismatchPct <= 1.0) return null;

  return `**Visual diff:** ${diff.mismatchPct}% pixel mismatch (${diff.diffImage})`;
}
