// Overlay-lag / trackpad interaction debug summaries. Lifted verbatim from PDFViewer; all capture-free.

import { OVERLAY_LAG_RECORDER_ATTRIBUTION_MIN_FRAME_RATIO, OVERLAY_LAG_RECORDER_ATTRIBUTION_MIN_MS, percentileOverlayRecorder, roundOverlayRecorderValue } from '../viewerShared';

export function buildTrackpadInteractionDebugSummaryText(trackpadDump) {
    const summaryLines = [];
    summaryLines.push(`# Trackpad Interaction Debug - ${trackpadDump?.metadata?.capturedAt || new Date().toISOString()}`);
    summaryLines.push(`events=${trackpadDump?.summary?.eventCount ?? 0}`);
    summaryLines.push(`sessions=${trackpadDump?.summary?.sessionCount ?? 0}`);
    summaryLines.push(`rawWheel=${trackpadDump?.summary?.totals?.rawWheel ?? 0}`);
    summaryLines.push(`rawZoomWheel=${trackpadDump?.summary?.totals?.rawZoomWheel ?? 0}`);
    summaryLines.push(`rawScrollWheel=${trackpadDump?.summary?.totals?.rawScrollWheel ?? 0}`);
    summaryLines.push(`processedZoom=${trackpadDump?.summary?.totals?.processedZoom ?? 0}`);
    summaryLines.push(`skippedZoom=${trackpadDump?.summary?.totals?.skippedZoom ?? 0}`);
    summaryLines.push(`processedScroll=${trackpadDump?.summary?.totals?.processedScroll ?? 0}`);
    summaryLines.push(`nativeScroll=${trackpadDump?.summary?.totals?.nativeScroll ?? 0}`);
    summaryLines.push(`pointerPanMoves=${trackpadDump?.summary?.totals?.pointerPanMoves ?? 0}`);
    summaryLines.push(`zoomAvgLatencyMs=${trackpadDump?.summary?.zoomAvgLatencyMs ?? 'n/a'}`);
    summaryLines.push(`zoomMaxLatencyMs=${trackpadDump?.summary?.zoomMaxLatencyMs ?? 'n/a'}`);
    summaryLines.push(`zoomAvgRequestedDeltaPct=${trackpadDump?.summary?.zoomAvgRequestedDeltaPct ?? 'n/a'}`);
    summaryLines.push(`zoomAvgActualDeltaPct=${trackpadDump?.summary?.zoomAvgActualDeltaPct ?? 'n/a'}`);
    summaryLines.push(`scrollAvgLatencyMs=${trackpadDump?.summary?.scrollAvgLatencyMs ?? 'n/a'}`);
    summaryLines.push(`scrollMaxLatencyMs=${trackpadDump?.summary?.scrollMaxLatencyMs ?? 'n/a'}`);
    summaryLines.push('');
    summaryLines.push('## Recent sessions');
    (trackpadDump?.summary?.recentSessions || []).forEach((session) => {
      summaryLines.push(
        `- #${session.id} ${session.family}/${session.direction || 'unknown'} ` +
        `events=${session.eventCount} raw=${session.rawWheelCount} processed=${session.processedCount} ignored=${session.ignoredCount} ` +
        `rawAbs=(${roundOverlayRecorderValue(session.rawAbsX, 2)},${roundOverlayRecorderValue(session.rawAbsY, 2)}) ` +
        `scrollAbs=(${roundOverlayRecorderValue(session.actualScrollAbsX, 2)},${roundOverlayRecorderValue(session.actualScrollAbsY, 2)}) ` +
        `zoomReq=${roundOverlayRecorderValue(session.zoomRequestedAbs, 3)} zoomActual=${roundOverlayRecorderValue(session.zoomActualAbs, 3)} ` +
        `maxLatency=${roundOverlayRecorderValue(session.maxLatencyMs, 3)}ms`
      );
    });
    return summaryLines.join('\n');
  }

export function summarizeOverlayLagSamples(samples = []) {
    if (!Array.isArray(samples) || samples.length === 0) {
      return {
        sampleCount: 0
      };
    }

    const frameDurations = samples.map((sample) => sample.frameMs).filter((value) => Number.isFinite(value) && value > 0);
    const driftValues = samples.map((sample) => sample.worstDriftPx).filter((value) => Number.isFinite(value));
    const scaleMismatchValues = samples.map((sample) => sample.worstScaleMismatch).filter((value) => Number.isFinite(value));
    const missingOverlayCounts = samples.map((sample) => sample.missingOverlayCount).filter((value) => Number.isFinite(value) && value >= 0);
    const sampleCaptureCosts = samples.map((sample) => sample.sampleCaptureCostMs).filter((value) => Number.isFinite(value) && value >= 0);
    const longTaskCounts = samples.map((sample) => sample.longTaskCount).filter((value) => Number.isFinite(value) && value >= 0);
    const longTaskTotals = samples.map((sample) => sample.longTaskTotalMs).filter((value) => Number.isFinite(value) && value >= 0);
    const eventTimingTotals = samples.map((sample) => sample.eventTimingTotalMs).filter((value) => Number.isFinite(value) && value >= 0);
    const visiblePresentationGapCounts = samples.map((sample) => sample.visiblePresentationGapCount).filter((value) => Number.isFinite(value) && value >= 0);
    const viewportPresentationGapCounts = samples.map((sample) => sample.viewportPresentationGapCount).filter((value) => Number.isFinite(value) && value >= 0);
    const samplesWithMissingOverlay = missingOverlayCounts.filter((count) => count > 0).length;
    const samplesWithVisiblePresentationGap = visiblePresentationGapCounts.filter((count) => count > 0).length;
    const samplesWithViewportPresentationGap = viewportPresentationGapCounts.filter((count) => count > 0).length;
    const jankThresholdMs = 32;
    const sampleJankFrames = frameDurations.filter((frameMs) => frameMs > jankThresholdMs).length;
    const samplesWithLongTasks = longTaskCounts.filter((count) => count > 0).length;
    const jankSamples = samples.filter((sample) => Number(sample.frameMs) > jankThresholdMs);
    const jankSamplesWithLongTasks = jankSamples.filter((sample) => Number(sample.longTaskCount) > 0).length;
    const lastSample = samples[samples.length - 1] || null;
    const rafFrameCount = Number(lastSample?.rafFrameCount) || frameDurations.length;
    const rafJankFrameCount = Number(lastSample?.rafJankFrameCount) || sampleJankFrames;
    const rafFrameMsAvg = Number(lastSample?.rafFrameMsAvg);
    const rafFrameMsMax = Number(lastSample?.rafFrameMsMax);

    const interactionEventTotals = {};
    samples.forEach((sample) => {
      if (!sample?.interactionEventDeltas || typeof sample.interactionEventDeltas !== 'object') return;
      Object.entries(sample.interactionEventDeltas).forEach(([key, value]) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric === 0) return;
        interactionEventTotals[key] = (interactionEventTotals[key] || 0) + numeric;
      });
    });
    const interactionEventHotspots = Object.entries(interactionEventTotals)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([eventType, count]) => ({ eventType, count }));

    const wheelPerfTotals = {};
    samples.forEach((sample) => {
      if (!sample?.wheelPerfDeltas || typeof sample.wheelPerfDeltas !== 'object') return;
      Object.entries(sample.wheelPerfDeltas).forEach(([key, value]) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric === 0) return;
        wheelPerfTotals[key] = (wheelPerfTotals[key] || 0) + numeric;
      });
    });
    const scrollRawAbsTotal = (Number(wheelPerfTotals.scrollRawAbsX) || 0) + (Number(wheelPerfTotals.scrollRawAbsY) || 0);
    const scrollClippedAbsTotal = (Number(wheelPerfTotals.scrollClippedAbsX) || 0) + (Number(wheelPerfTotals.scrollClippedAbsY) || 0);
    const scrollAppliedAbsTotal = (Number(wheelPerfTotals.scrollAppliedAbsX) || 0) + (Number(wheelPerfTotals.scrollAppliedAbsY) || 0);
    const scrollActualAbsTotal = (Number(wheelPerfTotals.scrollActualAbsX) || 0) + (Number(wheelPerfTotals.scrollActualAbsY) || 0);
    const zoomEvents = Number(wheelPerfTotals.zoomEvents) || 0;
    const scrollEvents = Number(wheelPerfTotals.scrollEvents) || 0;
    const wheelMotionSummary = {
      scrollEvents,
      scrollPreventedEvents: Number(wheelPerfTotals.scrollPreventedEvents) || 0,
      scrollClippedEvents: Number(wheelPerfTotals.scrollClippedEvents) || 0,
      scrollDiagonalEvents: Number(wheelPerfTotals.scrollDiagonalEvents) || 0,
      scrollRawAbsTotal: roundOverlayRecorderValue(scrollRawAbsTotal, 3),
      scrollClippedAbsTotal: roundOverlayRecorderValue(scrollClippedAbsTotal, 3),
      scrollAppliedAbsTotal: roundOverlayRecorderValue(scrollAppliedAbsTotal, 3),
      scrollActualAbsTotal: roundOverlayRecorderValue(scrollActualAbsTotal, 3),
      scrollClippedVsRawRatio: scrollRawAbsTotal > 0
        ? roundOverlayRecorderValue(scrollClippedAbsTotal / scrollRawAbsTotal, 4)
        : null,
      scrollAppliedVsRawRatio: scrollRawAbsTotal > 0
        ? roundOverlayRecorderValue(scrollAppliedAbsTotal / scrollRawAbsTotal, 4)
        : null,
      scrollActualVsRawRatio: scrollRawAbsTotal > 0
        ? roundOverlayRecorderValue(scrollActualAbsTotal / scrollRawAbsTotal, 4)
        : null,
      scrollActualVsAppliedRatio: scrollAppliedAbsTotal > 0
        ? roundOverlayRecorderValue(scrollActualAbsTotal / scrollAppliedAbsTotal, 4)
        : null,
      zoomEvents,
      zoomRawDeltaAbsTotal: roundOverlayRecorderValue(Number(wheelPerfTotals.zoomRawDeltaAbs) || 0, 3),
      zoomRequestedDeltaAbsTotal: roundOverlayRecorderValue(Number(wheelPerfTotals.zoomRequestedDeltaAbs) || 0, 3),
      zoomAvgRequestedDelta: zoomEvents > 0
        ? roundOverlayRecorderValue((Number(wheelPerfTotals.zoomRequestedDeltaAbs) || 0) / zoomEvents, 3)
        : null,
      zoomMaxRequestedDelta: roundOverlayRecorderValue(Number(wheelPerfTotals.zoomRequestedDeltaMax) || 0, 3),
      zoomAvgReportedLag: zoomEvents > 0
        ? roundOverlayRecorderValue((Number(wheelPerfTotals.zoomReportedLagAbs) || 0) / zoomEvents, 3)
        : null,
      zoomMaxReportedLag: roundOverlayRecorderValue(Number(wheelPerfTotals.zoomReportedLagMax) || 0, 3),
      zoomBigJumpEvents: Number(wheelPerfTotals.zoomBigJumpEvents) || 0
    };
    const idleWorkTotals = {};
    samples.forEach((sample) => {
      if (!sample?.idleWorkDeltas || typeof sample.idleWorkDeltas !== 'object') return;
      Object.entries(sample.idleWorkDeltas).forEach(([key, value]) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) return;
        idleWorkTotals[key] = (idleWorkTotals[key] || 0) + numeric;
      });
    });
    const idleWorkHotspots = Object.entries(idleWorkTotals)
      .filter(([key]) => key.endsWith('Ms'))
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([workType, durationMs]) => ({
        workType,
        durationMs: roundOverlayRecorderValue(durationMs, 3),
        count: roundOverlayRecorderValue(idleWorkTotals[workType.replace(/Ms$/, 'Count')] || 0, 3)
      }));
    const rawZoomSignalCount = (Number(interactionEventTotals.overlayWheelZoom) || 0) +
      (Number(interactionEventTotals.pdfjsWheelZoom) || 0);
    const workReductionSummary = {
      rawZoomSignalCount,
      pdfZoomWorkCount: zoomEvents,
      zoomSignalsCombined: rawZoomSignalCount > zoomEvents ? rawZoomSignalCount - zoomEvents : 0,
      zoomWorkReductionPct: rawZoomSignalCount > 0
        ? roundOverlayRecorderValue(((rawZoomSignalCount - zoomEvents) / rawZoomSignalCount) * 100, 2)
        : null
    };

    const slowFrameBuckets = {};
    jankSamples.forEach((sample) => {
      const phase = sample?.interactionPhase || 'unknown';
      const reason = sample?.interactionReason || 'idle';
      const key = `${phase}:${reason}`;
      const frameMs = Number(sample?.frameMs);
      if (!Number.isFinite(frameMs)) return;
      const bucket = slowFrameBuckets[key] || {
        phase,
        reason,
        count: 0,
        frameMsTotal: 0,
        frameMsMax: 0
      };
      bucket.count += 1;
      bucket.frameMsTotal += frameMs;
      bucket.frameMsMax = Math.max(bucket.frameMsMax, frameMs);
      slowFrameBuckets[key] = bucket;
    });
    const slowFrameHotspots = Object.values(slowFrameBuckets)
      .sort((left, right) => {
        if (right.frameMsTotal !== left.frameMsTotal) return right.frameMsTotal - left.frameMsTotal;
        return right.frameMsMax - left.frameMsMax;
      })
      .slice(0, 6)
      .map((bucket) => ({
        phase: bucket.phase,
        reason: bucket.reason,
        count: bucket.count,
        frameMsAvg: roundOverlayRecorderValue(bucket.frameMsTotal / bucket.count, 3),
        frameMsMax: roundOverlayRecorderValue(bucket.frameMsMax, 3),
        frameMsTotal: roundOverlayRecorderValue(bucket.frameMsTotal, 3)
      }));
    const classifySlowFrameWork = (sample) => {
      const idleWork = sample?.idleWorkDeltas || {};
      const events = sample?.interactionEventDeltas || {};
      const wheel = sample?.wheelPerfDeltas || {};
      const frameMs = Number(sample?.frameMs) || 0;
      if (Number(sample?.longTaskTotalMs) > 0) return 'longTask';
      const measuredWork = [
        ['annotationRestoration', Number(idleWork.annotationRestorationMs) || 0],
        ['pageRenderCatchup', Number(idleWork.pageRenderCatchupMs) || 0],
        ['pdfjsInternals', Number(idleWork.pdfjsInternalsMs) || 0],
        ['measurementWork', Math.max(Number(idleWork.measurementWorkMs) || 0, Number(sample?.sampleCaptureCostMs) || 0)]
      ].sort((left, right) => right[1] - left[1]);
      const strongestMeasuredMs = measuredWork[0]?.[1] || 0;
      const measuredFrameRatio = frameMs > 0 ? strongestMeasuredMs / frameMs : 0;
      if (
        strongestMeasuredMs >= OVERLAY_LAG_RECORDER_ATTRIBUTION_MIN_MS ||
        measuredFrameRatio >= OVERLAY_LAG_RECORDER_ATTRIBUTION_MIN_FRAME_RATIO
      ) {
        return measuredWork[0][0];
      }
      if (
        Number(events.pdfjsContainerMutation) > 0 ||
        Number(events.pdfjsContainerMapChange) > 0 ||
        Number(events.pdfjsPageChange) > 0
      ) return 'pageRenderCatchup';
      if (
        Number(wheel.scrollEvents) > 0 ||
        Number(wheel.zoomEvents) > 0 ||
        Number(events.pdfjsWheelScroll) > 0 ||
        Number(events.pdfjsScroll) > 0 ||
        Number(events.pdfjsZoomChange) > 0 ||
        Number(events.overlayWheelZoom) > 0
      ) return 'pdfjsInternals';
      return 'unattributedRafPause';
    };
    const slowFrameAttributionBuckets = {};
    jankSamples.forEach((sample) => {
      const workType = classifySlowFrameWork(sample);
      const frameMs = Number(sample?.frameMs);
      if (!Number.isFinite(frameMs)) return;
      const bucket = slowFrameAttributionBuckets[workType] || {
        workType,
        count: 0,
        frameMsTotal: 0,
        frameMsMax: 0
      };
      bucket.count += 1;
      bucket.frameMsTotal += frameMs;
      bucket.frameMsMax = Math.max(bucket.frameMsMax, frameMs);
      slowFrameAttributionBuckets[workType] = bucket;
    });
    const slowFrameAttributionHotspots = Object.values(slowFrameAttributionBuckets)
      .sort((left, right) => {
        if (right.frameMsTotal !== left.frameMsTotal) return right.frameMsTotal - left.frameMsTotal;
        return right.frameMsMax - left.frameMsMax;
      })
      .slice(0, 6)
      .map((bucket) => ({
        workType: bucket.workType,
        count: bucket.count,
        frameMsAvg: roundOverlayRecorderValue(bucket.frameMsTotal / bucket.count, 3),
        frameMsMax: roundOverlayRecorderValue(bucket.frameMsMax, 3),
        frameMsTotal: roundOverlayRecorderValue(bucket.frameMsTotal, 3)
      }));

    const worstFrameSample = samples.reduce((worst, sample) => {
      const frameMs = Number(sample?.frameMs);
      if (!Number.isFinite(frameMs)) return worst;
      if (!worst || frameMs > Number(worst.frameMs)) return sample;
      return worst;
    }, null);
    const worstFrameContext = worstFrameSample
      ? {
        tMs: worstFrameSample.tMs,
        frameMs: worstFrameSample.frameMs,
        currentPage: worstFrameSample.currentPage,
        appScale: worstFrameSample.appScale,
        viewerScale: worstFrameSample.viewerScale,
        interactionReason: worstFrameSample.interactionReason,
        interactionPhase: worstFrameSample.interactionPhase,
        scrollLeft: worstFrameSample.scrollLeft,
        scrollTop: worstFrameSample.scrollTop,
        wheelPerfDeltas: worstFrameSample.wheelPerfDeltas || {},
        idleWorkDeltas: worstFrameSample.idleWorkDeltas || {},
        interactionEventDeltas: worstFrameSample.interactionEventDeltas || {},
        longTaskCount: worstFrameSample.longTaskCount,
        longTaskTotalMs: worstFrameSample.longTaskTotalMs,
        eventTimingTotalMs: worstFrameSample.eventTimingTotalMs,
        missingOverlayCount: worstFrameSample.missingOverlayCount,
        visiblePresentationGapCount: worstFrameSample.visiblePresentationGapCount,
        viewportPresentationGapCount: worstFrameSample.viewportPresentationGapCount,
        sampledPageCount: worstFrameSample.sampledPageCount,
        pageModeCounts: worstFrameSample.pageModeCounts
      }
      : null;

    const longTaskSourceTotals = {};
    samples.forEach((sample) => {
      if (!Array.isArray(sample?.longTaskTopSources)) return;
      sample.longTaskTopSources.forEach((bucket) => {
        const source = String(bucket?.source || '');
        const durationMs = Number(bucket?.durationMs);
        if (!source || !Number.isFinite(durationMs) || durationMs <= 0) return;
        longTaskSourceTotals[source] = (longTaskSourceTotals[source] || 0) + durationMs;
      });
    });
    const longTaskHotspots = Object.entries(longTaskSourceTotals)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6)
      .map(([source, durationMs]) => ({
        source,
        durationMs: roundOverlayRecorderValue(durationMs, 3)
      }));

    const avg = (values) => {
      if (values.length === 0) return null;
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };

    return {
      sampleCount: samples.length,
      durationMs: roundOverlayRecorderValue((samples[samples.length - 1]?.tMs || 0) - (samples[0]?.tMs || 0), 1),
      frameMsAvg: roundOverlayRecorderValue(avg(frameDurations), 3),
      frameMsP95: roundOverlayRecorderValue(percentileOverlayRecorder(frameDurations, 0.95), 3),
      frameMsMax: roundOverlayRecorderValue(frameDurations.length ? Math.max(...frameDurations) : null, 3),
      fpsAvg: roundOverlayRecorderValue(frameDurations.length ? 1000 / avg(frameDurations) : null, 2),
      fpsAtP95Frame: roundOverlayRecorderValue(frameDurations.length ? 1000 / percentileOverlayRecorder(frameDurations, 0.95) : null, 2),
      fpsAtWorstFrame: roundOverlayRecorderValue(frameDurations.length ? 1000 / Math.max(...frameDurations) : null, 2),
      jankFrames: rafJankFrameCount,
      jankFrameRatePct: rafFrameCount > 0
        ? roundOverlayRecorderValue((rafJankFrameCount / rafFrameCount) * 100, 2)
        : null,
      sampleJankFrames,
      sampleJankFrameRatePct: frameDurations.length > 0
        ? roundOverlayRecorderValue((sampleJankFrames / frameDurations.length) * 100, 2)
        : null,
      rafFrameCount,
      rafFrameMsAvg: Number.isFinite(rafFrameMsAvg) ? rafFrameMsAvg : null,
      rafFrameMsMax: Number.isFinite(rafFrameMsMax) ? rafFrameMsMax : null,
      worstDriftPxMax: roundOverlayRecorderValue(driftValues.length ? Math.max(...driftValues) : null, 3),
      worstDriftPxP95: roundOverlayRecorderValue(percentileOverlayRecorder(driftValues, 0.95), 3),
      scaleMismatchMax: roundOverlayRecorderValue(scaleMismatchValues.length ? Math.max(...scaleMismatchValues) : null, 5),
      scaleMismatchP95: roundOverlayRecorderValue(percentileOverlayRecorder(scaleMismatchValues, 0.95), 5),
      missingOverlayCountAvg: roundOverlayRecorderValue(avg(missingOverlayCounts), 3),
      missingOverlayCountMax: roundOverlayRecorderValue(missingOverlayCounts.length ? Math.max(...missingOverlayCounts) : null, 3),
      samplesWithMissingOverlay,
      samplesWithMissingOverlayPct: missingOverlayCounts.length > 0
        ? roundOverlayRecorderValue((samplesWithMissingOverlay / missingOverlayCounts.length) * 100, 2)
        : null,
      visiblePresentationGapMax: roundOverlayRecorderValue(visiblePresentationGapCounts.length ? Math.max(...visiblePresentationGapCounts) : null, 3),
      samplesWithVisiblePresentationGap,
      samplesWithVisiblePresentationGapPct: visiblePresentationGapCounts.length > 0
        ? roundOverlayRecorderValue((samplesWithVisiblePresentationGap / visiblePresentationGapCounts.length) * 100, 2)
        : null,
      viewportPresentationGapMax: roundOverlayRecorderValue(viewportPresentationGapCounts.length ? Math.max(...viewportPresentationGapCounts) : null, 3),
      samplesWithViewportPresentationGap,
      samplesWithViewportPresentationGapPct: viewportPresentationGapCounts.length > 0
        ? roundOverlayRecorderValue((samplesWithViewportPresentationGap / viewportPresentationGapCounts.length) * 100, 2)
        : null,
      sampleCaptureCostMsAvg: roundOverlayRecorderValue(avg(sampleCaptureCosts), 3),
      sampleCaptureCostMsP95: roundOverlayRecorderValue(percentileOverlayRecorder(sampleCaptureCosts, 0.95), 3),
      longTaskCountTotal: longTaskCounts.length ? longTaskCounts.reduce((sum, value) => sum + value, 0) : 0,
      longTaskCountAvg: roundOverlayRecorderValue(avg(longTaskCounts), 3),
      longTaskTotalMs: roundOverlayRecorderValue(longTaskTotals.length ? longTaskTotals.reduce((sum, value) => sum + value, 0) : 0, 3),
      longTaskMsP95: roundOverlayRecorderValue(percentileOverlayRecorder(longTaskTotals, 0.95), 3),
      samplesWithLongTasks,
      samplesWithLongTasksPct: longTaskCounts.length > 0
        ? roundOverlayRecorderValue((samplesWithLongTasks / longTaskCounts.length) * 100, 2)
        : null,
      jankSamplesWithLongTasks,
      jankSamplesWithLongTasksPct: jankSamples.length > 0
        ? roundOverlayRecorderValue((jankSamplesWithLongTasks / jankSamples.length) * 100, 2)
        : null,
      eventTimingTotalMs: roundOverlayRecorderValue(eventTimingTotals.length ? eventTimingTotals.reduce((sum, value) => sum + value, 0) : 0, 3),
      eventTimingMsP95: roundOverlayRecorderValue(percentileOverlayRecorder(eventTimingTotals, 0.95), 3),
      interactionEventHotspots,
      wheelMotionSummary,
      idleWorkHotspots,
      workReductionSummary,
      slowFrameHotspots,
      slowFrameAttributionHotspots,
      worstFrameContext,
      longTaskHotspots
    };
  }
