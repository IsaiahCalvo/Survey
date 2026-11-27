import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';

import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import {
  LAYERS_META_KEY,
  addLayer,
  hiddenLayerIdSet,
  isOnHiddenLayer,
  normalizeLayerState,
  setLayerVisible,
} from '../src/utils/layers.js';

function createCloud(documentId) {
  const rows = [];
  let snapshot = null;
  const readBuilder = () => {
    let gtSeq = null;
    let selected = '';
    const filters = new Map();
    const builder = {
      select(columns) { selected = columns; return builder; },
      eq(column, value) { filters.set(column, value); return builder; },
      gt(_column, value) { gtSeq = Number(value); return builder; },
      order() { return builder; },
      limit() { return builder; },
      then(resolve, reject) {
        let data = rows.filter((row) => (
          [...filters].every(([column, value]) => row[column] === value)
          && (gtSeq == null || row.seq > gtSeq)
        ));
        if (selected === 'client_seq') data = data.map((row) => ({ client_seq: row.client_seq }));
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return builder;
  };
  return {
    makeClient(actor) {
      return {
        actor,
        supabase: {
          async rpc(name, args) {
            if (name === 'append_annotation_update') {
              const existing = rows.find((row) => row.client_id === args.p_client_id && row.client_seq === args.p_client_seq);
              if (existing) return { data: [{ seq: existing.seq }], error: null };
              const row = {
                document_id: documentId,
                client_id: args.p_client_id,
                client_seq: args.p_client_seq,
                actor_user_id: actor,
                data: args.p_data,
                seq: rows.length + 1,
              };
              rows.push(row);
              return { data: [{ seq: row.seq }], error: null };
            }
            if (name === 'store_annotation_snapshot') {
              snapshot = {
                snapshot: args.p_snapshot,
                at_seq: args.p_at_seq,
                encoding_version: args.p_encoding_version,
                writer_id: args.p_writer_id,
                writer_epoch: args.p_writer_epoch,
              };
              return { data: true, error: null };
            }
            throw new Error(`unexpected rpc ${name}`);
          },
          from(table) {
            if (table === 'annotation_updates') return readBuilder();
            if (table === 'annotation_snapshots') {
              return {
                select(columns) {
                  const wantsBody = /(^|[,\s])snapshot([,\s]|$)/.test(columns);
                  const b = {
                    eq() { return b; },
                    async maybeSingle() {
                      if (!snapshot) return { data: null, error: null };
                      if (wantsBody) return { data: { ...snapshot }, error: null };
                      const { snapshot: _body, ...identity } = snapshot;
                      return { data: identity, error: null };
                    },
                  };
                  return b;
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          },
        },
      };
    },
  };
}

function openDoc(client, { documentId, outboxStore, clientId, onPreview = null }) {
  return openAnnotationDoc({
    documentId,
    supabase: client.supabase,
    clientId,
    actorUserId: client.actor,
    enableLocal: false,
    enableRealtime: false,
    doc: new Y.Doc(),
    outboxStore,
    snapshotRetryDelayMs: 0,
    repairRetryDelayMs: 60_000,
    onPreview,
  });
}

test('#1766: open preview carries saved annotationLayers alongside marks on local-copy and cloud-snapshot reopens', async () => {
  const documentId = 'wave11-hidden-layer-preview';
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const outbox = createMemoryAnnotationOutbox();

  const { state: withCustom, layer } = addLayer(null, { id: 'layer-pass79', name: 'Pass79 QA Layer' });
  const hiddenState = setLayerVisible(withCustom, layer.id, false);
  const rect = {
    type: 'rect',
    left: 20,
    top: 30,
    width: 100,
    height: 60,
    stroke: '#ff0000',
    strokeWidth: 2,
    fill: 'transparent',
    layerId: layer.id,
    data: { id: 'rect-pass79', type: 'rect' },
  };

  const first = await openDoc(alice, { documentId, outboxStore: outbox, clientId: 'a1' });
  first.setMeta(LAYERS_META_KEY, hiddenState);
  first.applyByPage({ 1: { objects: [rect] } });
  await first.drain();
  assert.equal(await first.flushSnapshot(), true);
  await first.destroy();

  // 1) Same-device reopen (local-copy preview while Syncing)
  const localPreviews = [];
  const second = await openDoc(alice, {
    documentId,
    outboxStore: outbox,
    clientId: 'a2',
    onPreview: (byPage, meta) => localPreviews.push({ byPage, meta }),
  });
  await second.destroy();

  assert.ok(localPreviews.length >= 1, 'local-copy preview fired before cloud open finished');
  const localPreview = localPreviews.find((p) => p.meta.stage === 'local-copy');
  assert.ok(localPreview, 'local-copy preview stage emitted');
  assert.ok(localPreview.meta.annotationLayers, 'local-copy preview carries annotationLayers');
  const localNormalized = normalizeLayerState(localPreview.meta.annotationLayers);
  assert.equal(localNormalized.layers.find((l) => l.id === layer.id)?.visible, false);
  const localMark = localPreview.byPage[1]?.objects?.[0];
  assert.equal(localMark?.data?.id, 'rect-pass79');
  assert.equal(isOnHiddenLayer(localMark, hiddenLayerIdSet(localNormalized)), true, 'hidden-layer mark stays hidden during local-copy preview');

  // 2) Cold-device reopen (cloud-snapshot preview while Syncing)
  const cloudPreviews = [];
  const third = await openDoc(alice, {
    documentId,
    outboxStore: createMemoryAnnotationOutbox(),
    clientId: 'a3',
    onPreview: (byPage, meta) => cloudPreviews.push({ byPage, meta }),
  });
  await third.destroy();

  const cloudPreview = cloudPreviews.find((p) => p.meta.stage === 'cloud-snapshot');
  assert.ok(cloudPreview, 'cloud-snapshot preview stage emitted');
  assert.ok(cloudPreview.meta.annotationLayers, 'cloud-snapshot preview carries annotationLayers');
  const cloudNormalized = normalizeLayerState(cloudPreview.meta.annotationLayers);
  assert.equal(cloudNormalized.layers.find((l) => l.id === layer.id)?.visible, false);
  const cloudMark = cloudPreview.byPage[1]?.objects?.[0];
  assert.equal(isOnHiddenLayer(cloudMark, hiddenLayerIdSet(cloudNormalized)), true, 'hidden-layer mark stays hidden during cloud-snapshot preview');
});

test('#1766: useAnnotationDoc and PDFViewer apply preview annotationLayers in the same batch as preview marks', () => {
  const hook = readFileSync(new URL('../src/hooks/useAnnotationDoc.js', import.meta.url), 'utf8');
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(hook, /annotationLayers: previewLayers = null/);
  assert.match(hook, /if \(previewLayers && typeof onPreviewLayersRef\.current === 'function'\) \{\s*onPreviewLayersRef\.current\(previewLayers\);/);
  assert.match(viewer, /onPreviewLayers: \(value\) => previewLayersHandlerRef\.current\?\.\(value\),/);
  assert.match(viewer, /previewLayersHandlerRef\.current = \(value\) => \{\s*if \(layersEnabled\) setLayerState\(normalizeLayerState\(value\)\);/);
});

test('#1767: LayersPanel radio is a sibling button named only after the layer, not wrapping action buttons', () => {
  const src = readFileSync(new URL('../src/sidebar/LayersPanel.jsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/sidebar/LayersPanel.css', import.meta.url), 'utf8');

  // The outer .layers-row wrapper must not carry role="radio".
  const rowDivMatch = src.match(/<div\s+key=\{layer\.id\}[\s\S]*?className=\{`layers-row[\s\S]*?>/);
  assert.ok(rowDivMatch, 'outer layers-row div exists');
  assert.doesNotMatch(rowDivMatch[0], /role="radio"/, 'outer row wrapper is not a radio wrapping child buttons');

  // The radio control itself is a button whose only child is the layer name span.
  const radioBtnMatch = src.match(/<button\b(?:(?!<\/button>)[\s\S])*?role="radio"[\s\S]*?<\/button>/);
  assert.ok(radioBtnMatch, 'sibling radio button exists');
  assert.match(radioBtnMatch[0], /aria-checked=\{active\}/);
  assert.match(radioBtnMatch[0], /data-layer-id=\{layer\.id\}/);
  assert.match(radioBtnMatch[0], /<span className="layers-row__name">\{layer\.name\}<\/span>/);
  assert.doesNotMatch(radioBtnMatch[0], /Hide |Show |Rename |Delete /);

  // Action buttons remain separate sibling buttons with their own accessible labels.
  assert.match(src, /aria-label=\{layer\.visible \? `Hide \$\{layer\.name\}` : `Show \$\{layer\.name\}`\}/);
  assert.match(src, /aria-label=\{`Rename \$\{layer\.name\}`\}/);
  assert.match(src, /aria-label=\{`Delete \$\{layer\.name\}`\}/);
  assert.match(css, /\.layers-row__select\s*\{/);
  assert.match(css, /\.layers-row__select:focus-visible\s*\{/);
});

test('#1768: useMobileSheetMotion preserves first-move travel past slop, clamps velocity dt floor, and supports captured handle pointer drags', () => {
  const src = readFileSync(new URL('../src/mobile/useMobileSheetMotion.js', import.meta.url), 'utf8');

  // Pending-to-drag anchor must subtract only SHEET_SLOP_PX, not the entire first move delta.
  assert.match(src, /engage\(g\.y0 \+ \(Math\.sign\(dy\) \* SHEET_SLOP_PX\)\);/);
  // Velocity calculation clamps dt floor to avoid 1px sub-frame jitter spikes tripping pushedBack.
  assert.match(src, /const dt = Math\.max\(rawDt, 8\);/);
  // Handle supports non-touch pointer drag with pointer capture so mouse drags off the 20px handle close reliably.
  assert.match(src, /if \(event\.pointerType === 'touch' \|\| event\.button !== 0\) return;/);
  assert.match(src, /event\.target\?\.closest\?\.\('\.mobile-pdf-sheet__handle'\)/);
  assert.match(src, /sheet\.setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(src, /sheet\.addEventListener\('pointerdown', onPointerDown\);/);
  assert.match(src, /sheet\.removeEventListener\('pointerdown', onPointerDown\);/);
});
