import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import FabricEraserCanvas from '../components/FabricEraserCanvas.jsx';
import {
  applyEraseHistoryTransitionOnDoc,
  buildEraseIntent,
  commitEraseIntent,
} from '../utils/annotationEraseTransaction.js';
import { prepareEraseIntentForCommit } from '../utils/annotationEraseCommitPlan.js';
import {
  docToByPage,
  syncByPageToDoc,
} from '../services/annotationDocStore.js';
import { createDetachedYDoc } from '../lib/collab/ydocRegistry.js';
import { createAnnotationStorageKeyResolver } from '../utils/annotationStorageIdentity.js';
import { getCounterRenderGeometry } from '../utils/counterGeometry.js';

const PAGE_WIDTH = 640;
const PAGE_HEIGHT = 480;
const DOCUMENT_ID = 'dev-atomic-eraser-harness';
const ACTOR_ID = 'dev-atomic-eraser-owner';
const ORIGIN = 'dev-atomic-eraser';

function seedAnnotations() {
  return {
    1: {
      objects: [
        {
          type: 'path',
          id: 'harness-pen',
          left: 0,
          top: 0,
          width: 480,
          height: 40,
          fill: '#e11d48',
          stroke: 'transparent',
          strokeWidth: 0,
          sourceWidth: 40,
          paperInkGeometry: 'v1',
          path: [
            ['M', 80, 120],
            ['L', 560, 120],
            ['L', 560, 160],
            ['L', 80, 160],
            ['Z'],
          ],
          polygons: [[[
            [80, 120],
            [560, 120],
            [560, 160],
            [80, 160],
            [80, 120],
          ]]],
          data: {
            id: 'harness-pen',
            tool: 'pen',
            authorId: ACTOR_ID,
          },
          meta: { authorId: ACTOR_ID, createdAt: 1 },
        },
        ...[1, 2, 3].map((displayNumber) => ({
          type: 'circle',
          id: `harness-counter-${displayNumber}`,
          left: 145 + displayNumber * 115,
          top: 280,
          radius: 22,
          width: 44,
          height: 44,
          fill: '#fef3c7',
          stroke: '#b45309',
          strokeWidth: 3,
          data: {
            id: `harness-counter-${displayNumber}`,
            type: 'counter',
            annotationType: 'counter',
            tool: 'counter',
            displayNumber,
            seriesId: 'harness-series',
            seriesStart: 1,
            createdAt: displayNumber,
            authorId: ACTOR_ID,
          },
          meta: { authorId: ACTOR_ID, createdAt: displayNumber },
        })),
      ],
    },
  };
}

function polygonPath(polygons) {
  return (polygons || []).flatMap((polygon) => (
    (polygon || []).map((ring) => {
      if (!Array.isArray(ring) || ring.length === 0) return '';
      return `${ring.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')} Z`;
    })
  )).filter(Boolean).join(' ');
}

function objectId(object) {
  return object?.data?.id ?? object?.id ?? null;
}

function AtomicObject({ object, index }) {
  const id = objectId(object);
  if (object?.data?.type === 'counter') {
    const radius = (Number(object.radius) || 14) * Math.abs(Number(object.scaleX) || 1);
    const cx = Number(object.left || 0) + radius;
    const cy = Number(object.top || 0) + radius;
    const geometry = getCounterRenderGeometry(
      cx,
      cy,
      radius,
      object.data.pointerAngle ?? 225,
    );
    return (
      <g data-annotation-index={index} data-annotation-id={id}>
        <path d={geometry.pathD} fill={object.fill || '#fef3c7'} />
        <text
          x={cx}
          y={cy + 7}
          textAnchor="middle"
          fontFamily="Helvetica"
          fontSize="20"
          fontWeight="700"
          fill="#78350f"
        >
          {object.data.displayNumber}
        </text>
      </g>
    );
  }
  return (
    <path
      data-annotation-index={index}
      data-annotation-id={id}
      d={polygonPath(object?.polygons)}
      fill={object?.fill || '#e11d48'}
      fillRule="evenodd"
    />
  );
}

export default function AtomicEraseHarness() {
  const runtimeRef = useRef(null);
  if (!runtimeRef.current) {
    const doc = createDetachedYDoc(DOCUMENT_ID);
    syncByPageToDoc(doc, seedAnnotations());
    runtimeRef.current = {
      doc,
      undoTransitions: [],
      redoTransitions: [],
    };
  }

  const [annotationsByPage, setAnnotationsByPage] = useState(
    () => docToByPage(runtimeRef.current.doc),
  );
  const [eraserMode, setEraserMode] = useState('partial');
  const [eraserSize, setEraserSize] = useState(24);
  const [revision, setRevision] = useState('');
  const annotations = annotationsByPage[1] || { objects: [] };

  const materialize = useCallback((presentationRevision = '') => {
    const byPage = docToByPage(runtimeRef.current.doc);
    const next = {
      ...byPage,
      1: {
        ...(byPage[1] || { objects: [] }),
        ...(presentationRevision ? { eraserPresentationRevision: presentationRevision } : {}),
      },
    };
    setAnnotationsByPage(next);
    if (presentationRevision) setRevision(presentationRevision);
    return next;
  }, []);

  const commit = useCallback(async (rawIntent) => {
    const before = docToByPage(runtimeRef.current.doc);
    const currentByStorageKey = new Map();
    const resolveStorageKey = createAnnotationStorageKeyResolver();
    for (const [pageKey, page] of Object.entries(before)) {
      for (const object of page?.objects || []) {
        currentByStorageKey.set(
          String(resolveStorageKey(object, Number(pageKey), objectId(object))),
          object,
        );
      }
    }
    const intent = prepareEraseIntentForCommit({
      intent: buildEraseIntent(rawIntent),
      annotationsByPage: before,
      userId: ACTOR_ID,
      includeDeleteHistory: false,
    });
    const result = await commitEraseIntent({
      doc: runtimeRef.current.doc,
      intent,
      origin: ORIGIN,
      actorUserId: ACTOR_ID,
      eraserWriterId: ACTOR_ID,
      permissionContext: { mode: 'local-only' },
      validateTarget: () => true,
      materializePageTarget: (target) => (
        currentByStorageKey.get(String(target.storageKey))
      ),
    });
    const byPage = materialize(intent.presentationRevision);
    if (result.status === 'committed' && result.historyTransition) {
      runtimeRef.current.undoTransitions.push(result.historyTransition);
      runtimeRef.current.redoTransitions.length = 0;
      window.__atomicEraseHarnessTransitions.push(structuredClone(result.historyTransition));
    }
    window.__lastEraseTransaction = {
      mutationId: intent.mutationId,
      status: result.status,
      reason: result.reason || null,
      targetCount: intent.targets.length,
      historyTransition: result.historyTransition
        ? structuredClone(result.historyTransition)
        : null,
    };
    window.__atomicEraseHarnessTransactions.push(
      structuredClone(window.__lastEraseTransaction),
    );
    window.__atomicEraseHarnessIntents.push(structuredClone(intent));
    return { ...result, byPage };
  }, [materialize]);

  const undo = useCallback(() => {
    const transition = runtimeRef.current.undoTransitions.pop();
    if (!transition) return { status: 'noop', reason: 'empty-history' };
    const result = applyEraseHistoryTransitionOnDoc({
      doc: runtimeRef.current.doc,
      transition,
      direction: 'undo',
      origin: `${ORIGIN}:undo`,
    });
    if (result.status === 'applied' || result.status === 'noop') {
      runtimeRef.current.redoTransitions.push(transition);
      materialize(`undo-${Date.now()}`);
    } else {
      runtimeRef.current.undoTransitions.push(transition);
    }
    window.__lastEraseHistoryTransition = {
      direction: 'undo',
      transition: structuredClone(transition),
      result: structuredClone(result),
    };
    return result;
  }, [materialize]);
  const redo = useCallback(() => {
    const transition = runtimeRef.current.redoTransitions.pop();
    if (!transition) return { status: 'noop', reason: 'empty-history' };
    const result = applyEraseHistoryTransitionOnDoc({
      doc: runtimeRef.current.doc,
      transition,
      direction: 'redo',
      origin: `${ORIGIN}:redo`,
    });
    if (result.status === 'applied' || result.status === 'noop') {
      runtimeRef.current.undoTransitions.push(transition);
      materialize(`redo-${Date.now()}`);
    } else {
      runtimeRef.current.redoTransitions.push(transition);
    }
    window.__lastEraseHistoryTransition = {
      direction: 'redo',
      transition: structuredClone(transition),
      result: structuredClone(result),
    };
    return result;
  }, [materialize]);

  useEffect(() => {
    window.__atomicEraseHarnessIntents = [];
    window.__atomicEraseHarnessTransitions = [];
    window.__atomicEraseHarnessTransactions = [];
    window.__atomicEraseHarness = {
      documentId: DOCUMENT_ID,
      actorId: ACTOR_ID,
      getByPage: () => structuredClone(docToByPage(runtimeRef.current.doc)),
      getAnnotationById: (id) => {
        const objects = docToByPage(runtimeRef.current.doc)[1]?.objects || [];
        return structuredClone(objects.find((object) => objectId(object) === id) || null);
      },
      undo,
      redo,
      getHistoryDepths: () => ({
        undo: runtimeRef.current.undoTransitions.length,
        redo: runtimeRef.current.redoTransitions.length,
      }),
      applyRemoteBaseEdit: (id, patch = {}) => {
        const annotations = runtimeRef.current.doc.getMap('annotations');
        let storageKey = null;
        let stored = null;
        annotations.forEach((entry, key) => {
          if (storageKey || objectId(entry?.o ?? entry) !== id) return;
          storageKey = key;
          stored = entry;
        });
        if (!storageKey || !stored) return null;
        runtimeRef.current.doc.transact(() => {
          annotations.set(storageKey, {
            ...stored,
            o: {
              ...stored.o,
              ...structuredClone(patch),
              data: {
                ...(stored.o?.data || {}),
                ...(patch?.data || {}),
              },
            },
          });
        }, `${ORIGIN}:remote-edit`);
        materialize(`remote-${Date.now()}`);
        return structuredClone(
          docToByPage(runtimeRef.current.doc)[1]?.objects
            ?.find((object) => objectId(object) === id)
          || null,
        );
      },
      encodeState: () => Array.from(Y.encodeStateAsUpdate(runtimeRef.current.doc)),
    };
    return () => {
      runtimeRef.current?.doc?.destroy();
      delete window.__atomicEraseHarness;
      delete window.__atomicEraseHarnessIntents;
      delete window.__atomicEraseHarnessTransitions;
      delete window.__atomicEraseHarnessTransactions;
    };
  }, [materialize, redo, undo]);

  return (
    <main
      data-atomic-erase-harness-ready="true"
      style={{
        minHeight: '100vh',
        padding: 24,
        boxSizing: 'border-box',
        background: '#111827',
        color: '#f9fafb',
        fontFamily: 'Helvetica, Arial, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <strong>Atomic eraser harness</strong>
        <label>
          Mode{' '}
          <select
            aria-label="Eraser mode"
            value={eraserMode}
            onChange={(event) => setEraserMode(event.target.value)}
          >
            <option value="partial">Partial erase</option>
            <option value="full">Full erase</option>
          </select>
        </label>
        <label>
          Diameter{' '}
          <input
            aria-label="Eraser diameter"
            type="number"
            min="1"
            max="160"
            value={eraserSize}
            onChange={(event) => setEraserSize(Number(event.target.value) || 1)}
          />
        </label>
        <button type="button" onClick={undo}>Undo</button>
        <button type="button" onClick={redo}>Redo</button>
        <span data-harness-object-count>{annotations.objects?.length || 0} objects</span>
      </div>

      <div
        data-annotation-real-surface
        style={{
          position: 'relative',
          width: PAGE_WIDTH,
          height: PAGE_HEIGHT,
          background: '#fff',
          border: '1px solid #475569',
          boxShadow: '0 16px 40px rgba(0,0,0,.3)',
        }}
      >
        <div
          data-diag-svg-wrapper
          data-svg-annotation-revision={revision}
          style={{ position: 'absolute', inset: 0 }}
        >
          <svg
            data-svg-annotation-layer
            viewBox={`0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}`}
            width="100%"
            height="100%"
            style={{ display: 'block' }}
          >
            {(annotations.objects || []).map((object, index) => (
              <AtomicObject key={objectId(object) || index} object={object} index={index} />
            ))}
          </svg>
        </div>
        <FabricEraserCanvas
          pageNumber={1}
          pageWidth={PAGE_WIDTH}
          pageHeight={PAGE_HEIGHT}
          annotations={annotations}
          onEraseIntent={commit}
          renderer="svg"
          eraserMode={eraserMode}
          eraserSize={eraserSize}
          viewerScale={1}
          spaces={[]}
          zoomGeneration={0}
          viewerId={ACTOR_ID}
          documentOwnerId={ACTOR_ID}
        />
      </div>
    </main>
  );
}
