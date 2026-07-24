import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';

import FabricEraserCanvas from '../components/FabricEraserCanvas';
import {
  docToByPage,
  syncByPageToDoc,
} from '../services/annotationDocStore';
import {
  renderPathToSvgAttrs,
  renderPathToSvgD,
} from '../utils/svgPathAttrs';
import { createProductionPaperInk } from '../utils/productionPaperInk';

const PAGE_WIDTH = 400;
const PAGE_HEIGHT = 260;
const PAGE_NUMBER = 1;
const TARGET_ID = 'mounted-shared-target';

const now = () => Math.round(performance.timeOrigin + performance.now());

const bytesToBase64 = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value) => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const createTarget = () => createProductionPaperInk({
  id: TARGET_ID,
  tool: 'pen',
  points: [{ x: 50, y: 130 }, { x: 270, y: 130 }],
  color: '#dc2626',
  width: 20,
  data: { id: TARGET_ID, tool: 'pen', remoteEdit: false },
});

const withPaintRevision = (page = { objects: [] }) => {
  const acknowledgments = page.eraserMaterializedMutationIds || [];
  return {
    ...page,
    eraserPresentationRevision: acknowledgments[acknowledgments.length - 1] || '',
  };
};

const materializePage = (doc) => withPaintRevision(
  docToByPage(doc)[PAGE_NUMBER] || { objects: [] },
);

const makeHarnessState = (session) => {
  const doc = new Y.Doc();
  const storageKey = `survey:eraser-race:${session}`;
  const stored = localStorage.getItem(storageKey);
  if (stored) Y.applyUpdate(doc, base64ToBytes(stored), 'cold-reload');
  if (!stored) {
    syncByPageToDoc(doc, {
      [PAGE_NUMBER]: { objects: [createTarget()] },
    }, { origin: 'harness-init' });
    localStorage.setItem(storageKey, bytesToBase64(Y.encodeStateAsUpdate(doc)));
  }
  return { doc, storageKey };
};

function HarnessPath({ object }) {
  const attrs = renderPathToSvgAttrs(object);
  return (
    <path
      data-shared-target={object?.data?.id || object?.id}
      d={renderPathToSvgD(object, attrs)}
      transform={`translate(${Number(object.left) || 0} ${Number(object.top) || 0})`}
      stroke={attrs.stroke}
      strokeWidth={attrs.strokeWidth}
      strokeLinecap={attrs.strokeLinecap}
      strokeLinejoin={attrs.strokeLinejoin}
      fill={attrs.fill}
      fillRule={attrs.fillRule}
      opacity={attrs.opacity}
    />
  );
}

export default function EraserTwoClientRaceHarness() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const role = params.get('raceRole') === 'b' ? 'b' : 'a';
  const session = params.get('raceSession') || 'default';
  const writerId = `mounted-${session}-${role}`;
  const harness = useMemo(() => makeHarnessState(session), [session]);
  const channelRef = useRef(null);
  const outboundActionRef = useRef(null);
  const [page, setPage] = useState(() => materializePage(harness.doc));
  const pageRef = useRef(page);
  const [previewActive, setPreviewActive] = useState(false);
  const [settledWithAck, setSettledWithAck] = useState(false);
  const [armedAction, setArmedAction] = useState(null);
  const [eraseCommitted, setEraseCommitted] = useState(false);
  const [events, setEvents] = useState([]);
  pageRef.current = page;

  const record = useCallback((type, detail = {}) => {
    setEvents((current) => [...current.slice(-39), { type, at: now(), ...detail }]);
  }, []);

  const publishMaterializedPage = useCallback(() => {
    setPage(materializePage(harness.doc));
  }, [harness.doc]);

  const applyRemoteAction = useCallback((action) => {
    const before = docToByPage(harness.doc);
    const currentPage = before[PAGE_NUMBER] || { objects: [] };
    const target = currentPage.objects.find((object) => (
      (object?.data?.id || object?.id) === TARGET_ID
    ));
    if (!target) {
      record(`b-${action}-no-target`);
      return;
    }
    let nextObjects;
    if (action === 'delete') {
      nextObjects = currentPage.objects.filter((object) => object !== target);
    } else if (action === 'move') {
      nextObjects = currentPage.objects.map((object) => (
        object === target
          ? {
              ...object,
              left: (Number(object.left) || 0) + 80,
              fill: '#2563eb',
              data: { ...(object.data || {}), remoteEdit: true, remoteAction: 'move' },
            }
          : object
      ));
    } else {
      nextObjects = currentPage.objects.map((object) => (
        object === target
          ? {
              ...object,
              fill: '#2563eb',
              opacity: 0.72,
              data: { ...(object.data || {}), remoteEdit: true, remoteAction: 'edit' },
            }
          : object
      ));
    }
    outboundActionRef.current = action;
    syncByPageToDoc(harness.doc, {
      ...before,
      [PAGE_NUMBER]: { ...currentPage, objects: nextObjects },
    }, {
      origin: `mounted-remote-${action}`,
      prevByPage: before,
      eraserWriterId: writerId,
    });
    record(`b-${action}-committed`);
  }, [harness.doc, record, writerId]);

  useEffect(() => {
    const channel = new BroadcastChannel(`survey-eraser-race-${session}`);
    channelRef.current = channel;

    const persist = () => {
      localStorage.setItem(
        harness.storageKey,
        bytesToBase64(Y.encodeStateAsUpdate(harness.doc)),
      );
    };
    const onDocUpdate = (update, origin) => {
      persist();
      publishMaterializedPage();
      if (origin === 'mounted-broadcast' || origin === 'cold-reload') return;
      channel.postMessage({
        kind: 'y-update',
        update: bytesToBase64(update),
        action: outboundActionRef.current,
        sender: role,
        at: now(),
      });
      outboundActionRef.current = null;
    };
    const onMessage = (event) => {
      const message = event.data || {};
      if (message.kind === 'schedule-action' && role === 'b') {
        record(`b-${message.action}-scheduled`, { requestedAt: message.at });
        setTimeout(() => applyRemoteAction(message.action), message.delay || 30);
        return;
      }
      if (message.kind !== 'y-update' || message.sender === role || !message.update) return;
      Y.applyUpdate(harness.doc, base64ToBytes(message.update), 'mounted-broadcast');
      persist();
      publishMaterializedPage();
      record(`remote-${message.action || 'update'}-applied`, { sentAt: message.at });
    };

    harness.doc.on('update', onDocUpdate);
    channel.addEventListener('message', onMessage);
    channel.postMessage({
      kind: 'y-update',
      update: bytesToBase64(Y.encodeStateAsUpdate(harness.doc)),
      action: 'bootstrap',
      sender: role,
      at: now(),
    });
    persist();

    return () => {
      harness.doc.off('update', onDocUpdate);
      channel.removeEventListener('message', onMessage);
      channel.close();
      channelRef.current = null;
    };
  }, [
    applyRemoteAction,
    harness.doc,
    harness.storageKey,
    publishMaterializedPage,
    record,
    role,
    session,
  ]);

  const handleEraseCommit = useCallback((updatedJson, diagnostics = {}) => {
    const parsed = typeof updatedJson === 'string' ? JSON.parse(updatedJson) : updatedJson;
    const before = docToByPage(harness.doc);
    const mutationId = diagnostics.eraserMutationId;
    outboundActionRef.current = 'erase';
    syncByPageToDoc(harness.doc, {
      ...before,
      [PAGE_NUMBER]: {
        ...parsed,
        eraserMutation: {
          id: mutationId,
          pageNumber: PAGE_NUMBER,
          points: diagnostics.eraserPoints,
          radius: diagnostics.eraserRadius,
          mode: diagnostics.eraserMode,
          touchedIds: diagnostics.touchedAnnotationIds,
          changedIds: diagnostics.finalChangedAnnotationIds,
          deletedIds: diagnostics.finalDeletedAnnotationIds,
          objectMutations: diagnostics.objectMutations,
        },
      },
    }, {
      origin: 'mounted-local-erase',
      prevByPage: before,
      eraserWriterId: writerId,
    });
    publishMaterializedPage();
    setEraseCommitted(true);
    record('a-erase-committed', { mutationId });
    return { requireMutationAck: true };
  }, [harness.doc, publishMaterializedPage, record, writerId]);

  const target = page.objects.find((object) => (
    (object?.data?.id || object?.id) === TARGET_ID
  ));
  const targetXs = (target?.polygons || [])
    .flatMap((polygon) => polygon.flatMap((ring) => ring.map(([x]) => Number(x))))
    .filter(Number.isFinite);
  const targetMinX = targetXs.length ? Math.min(...targetXs) : null;
  const targetMaxX = targetXs.length ? Math.max(...targetXs) : null;
  const acknowledgments = page.eraserMaterializedMutationIds || [];
  const latestEvent = events[events.length - 1];

  const arm = (action) => {
    setArmedAction(action);
    record(`a-${action}-armed`);
  };

  const requestScheduledAction = () => {
    if (role !== 'a' || !armedAction) return;
    record('a-pointer-down', { action: armedAction });
    channelRef.current?.postMessage({
      kind: 'schedule-action',
      action: armedAction,
      delay: 30,
      sender: role,
      at: now(),
    });
    setArmedAction(null);
  };

  return (
    <main
      data-eraser-race-harness="true"
      data-race-role={role}
      data-race-session={session}
      data-race-object-present={target ? 'true' : 'false'}
      data-race-left={target ? String(Number(target.left) || 0) : ''}
      data-race-min-x={targetMinX == null ? '' : String(targetMinX)}
      data-race-max-x={targetMaxX == null ? '' : String(targetMaxX)}
      data-race-color={target?.fill || target?.stroke || ''}
      data-race-remote-edit={target?.data?.remoteEdit ? 'true' : 'false'}
      data-race-preview-active={previewActive ? 'true' : 'false'}
      data-race-erase-committed={eraseCommitted ? 'true' : 'false'}
      data-race-settled-with-ack={settledWithAck ? 'true' : 'false'}
      data-race-revision={page.eraserPresentationRevision || ''}
      data-race-acks={acknowledgments.join(' ')}
      data-race-last-event={latestEvent?.type || ''}
      style={{
        minHeight: '100vh',
        margin: 0,
        padding: 24,
        background: '#111827',
        color: '#f9fafb',
        fontFamily: 'Helvetica',
      }}
    >
      <h1>Mounted eraser race · client {role.toUpperCase()}</h1>
      <p>Session {session}. A holds the real eraser pointer while B mutates the same Y.Doc target.</p>

      <section style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {role === 'a' ? (
          <>
            <button type="button" data-arm-action="edit" onClick={() => arm('edit')}>Arm remote edit</button>
            <button type="button" data-arm-action="move" onClick={() => arm('move')}>Arm remote move</button>
            <button type="button" data-arm-action="delete" onClick={() => arm('delete')}>Arm remote delete</button>
          </>
        ) : (
          <>
            <button type="button" data-remote-action="edit" onClick={() => applyRemoteAction('edit')}>Edit now</button>
            <button type="button" data-remote-action="move" onClick={() => applyRemoteAction('move')}>Move now</button>
            <button type="button" data-remote-action="delete" onClick={() => applyRemoteAction('delete')}>Delete now</button>
          </>
        )}
      </section>

      <div
        data-annotation-real-surface="1"
        onPointerDownCapture={requestScheduledAction}
        onPointerUpCapture={() => record('a-pointer-up')}
        style={{
          position: 'relative',
          width: 800,
          height: 520,
          background: '#fff',
          border: armedAction ? '4px solid #f59e0b' : '4px solid #334155',
          boxSizing: 'border-box',
        }}
      >
        <div
          data-diag-svg-wrapper="1"
          data-svg-annotation-revision={page.eraserPresentationRevision || ''}
          data-eraser-materialized-mutation-ids={acknowledgments.join(' ')}
          style={{ position: 'absolute', inset: 0 }}
        >
          <svg
            data-svg-annotation-layer="1"
            viewBox={`0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}`}
            width="100%"
            height="100%"
            style={{ display: 'block' }}
          >
            {page.objects.map((object) => (
              <HarnessPath key={object?.data?.id || object?.id} object={object} />
            ))}
          </svg>
        </div>
        {role === 'a' && (
          <FabricEraserCanvas
            pageNumber={PAGE_NUMBER}
            pageWidth={PAGE_WIDTH}
            pageHeight={PAGE_HEIGHT}
            annotations={page}
            onEraseCommit={handleEraseCommit}
            onErasePreviewPresentation={(_pageNumber, active) => {
              setPreviewActive(active);
              if (!active) {
                const currentPage = pageRef.current;
                const revision = currentPage.eraserPresentationRevision || '';
                setSettledWithAck(Boolean(
                  revision
                  && (currentPage.eraserMaterializedMutationIds || []).includes(revision),
                ));
              }
              record(active ? 'a-preview-start' : 'a-preview-settled');
            }}
            eraserMode="partial"
            eraserSize={28}
            viewerScale={2}
            zoomGeneration={0}
          />
        )}
        {role === 'a' && eraseCommitted && (
          <div
            data-race-gesture-complete="true"
            style={{ position: 'absolute', inset: 0, zIndex: 102 }}
          />
        )}
      </div>

      <dl style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 6, marginTop: 16 }}>
        <dt>Target</dt><dd data-status="target">{target ? 'present' : 'deleted'}</dd>
        <dt>Left</dt><dd data-status="left">{target ? Number(target.left) || 0 : '—'}</dd>
        <dt>Color</dt><dd data-status="color">{target?.fill || target?.stroke || '—'}</dd>
        <dt>Remote edit</dt><dd data-status="remote-edit">{target?.data?.remoteEdit ? 'yes' : 'no'}</dd>
        <dt>Preview</dt><dd data-status="preview">{previewActive ? 'active' : 'settled'}</dd>
        <dt>Revision</dt><dd data-status="revision">{page.eraserPresentationRevision || 'none'}</dd>
        <dt>Acknowledgments</dt><dd data-status="acks">{acknowledgments.join(' ') || 'none'}</dd>
        <dt>Last event</dt><dd data-status="event">{latestEvent?.type || 'none'}</dd>
      </dl>

      <ol data-race-events>
        {events.map((event, index) => (
          <li key={`${event.at}-${index}`}>{event.at} · {event.type}</li>
        ))}
      </ol>
    </main>
  );
}
