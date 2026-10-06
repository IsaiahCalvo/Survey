#!/usr/bin/env node
// Child-process helper for tp-fake-backend.mjs: runs the app's own store code
// (src/services/annotationDocStore.js) in plain Node. Playwright's test loader
// treats the repo's .js files as CommonJS, so the specs cannot import them
// directly; this script is spawned instead. JSON in on stdin, JSON out.
//   { op: 'seed', byPage, lanes }  -> { hex }   one Y update holding the marks
//   { op: 'decode', rows }         -> { byPage, lanes }  every WAL row applied
import * as Y from 'yjs';
import * as store from '../../../src/services/annotationDocStore.js';

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));

const plain = (v) => (v && typeof v.toJSON === 'function' ? v.toJSON() : v);

if (input.op === 'seed') {
  const doc = new Y.Doc();
  store.syncByPageToDoc(doc, input.byPage || {});
  doc.transact(() => {
    for (const [key, lane] of Object.entries(input.lanes || {})) store.getEraserOpsMap(doc).set(key, lane);
  });
  process.stdout.write(JSON.stringify({ hex: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('hex') }));
} else if (input.op === 'decode') {
  const doc = new Y.Doc();
  for (const row of input.rows || []) {
    const hex = String(row.data).replace(/^\\x/, '');
    Y.applyUpdate(doc, Uint8Array.from(Buffer.from(hex, 'hex')));
  }
  const lanes = {};
  store.getEraserOpsMap(doc).forEach((lane, key) => { lanes[key] = plain(lane); });
  let surveyMarkers = null;
  try { surveyMarkers = store.docToSurveyMarkers(doc); } catch { surveyMarkers = null; }
  process.stdout.write(JSON.stringify({ byPage: store.docToByPage(doc), lanes, surveyMarkers }));
} else if (input.op === 'toPage') {
  // Ink outlines in PAGE units, through the app's one affine for rendering,
  // erasing and export (imported ink keeps local commands + left/top).
  const { createInkPathAffine } = await import('../../../src/utils/inkGeometryTransform.js');
  const paths = (input.objects || []).map((object) => {
    if (!object?.path) return null;
    const affine = createInkPathAffine(object, object.path);
    return object.path.map((command) => {
      const out = [command[0]];
      for (let i = 1; i + 1 < command.length; i += 2) {
        const p = affine.point(command[i], command[i + 1]);
        out.push(p.x, p.y);
      }
      return out;
    });
  });
  process.stdout.write(JSON.stringify({ paths }));
} else {
  process.stderr.write(`unknown op ${input.op}\n`);
  process.exit(2);
}
