import test from 'node:test';
import assert from 'node:assert/strict';

import {
  composeColorForPatch,
  materializeFabricAnnotationFromYMap,
} from '../src/utils/annotationData.js';

test('composeColorForPatch handles transparent, rgba, and passthrough', () => {
  assert.equal(composeColorForPatch(null, 50), 'transparent');
  assert.equal(composeColorForPatch('transparent', 50), 'transparent');
  assert.equal(composeColorForPatch('#ff0000', 50), 'rgba(255, 0, 0, 0.5)');
  assert.equal(composeColorForPatch('#00ff00', null), 'rgba(0, 255, 0, 1)');
  assert.equal(composeColorForPatch('rgb(1,2,3)', 40), 'rgb(1,2,3)');
});

test('materializeFabricAnnotationFromYMap returns null for invalid maps', () => {
  assert.equal(materializeFabricAnnotationFromYMap(null), null);
  assert.equal(materializeFabricAnnotationFromYMap({}), null);
  assert.equal(materializeFabricAnnotationFromYMap({
    get: () => null,
  }), null);
});

test('materializeFabricAnnotationFromYMap hydrates fabric + meta from Y maps', () => {
  const fabric = {
    toJSON: () => ({ type: 'rect', data: {} }),
  };
  const meta = {
    get(key) {
      if (key === 'authorId') return 'author-1';
      if (key === 'lastEditorId') return 'editor-1';
      return null;
    },
  };
  const anno = {
    get(key) {
      if (key === 'fabric') return fabric;
      if (key === 'id') return 'anno-1';
      if (key === 'pageNumber') return 4;
      if (key === 'meta') return meta;
      return null;
    },
  };
  const result = materializeFabricAnnotationFromYMap(anno);
  assert.equal(result.id, 'anno-1');
  assert.equal(result.pageNumber, 4);
  assert.equal(result.fabricObj.data.id, 'anno-1');
  assert.equal(result.fabricObj.id, 'anno-1');
  assert.equal(result.fabricObj.meta.authorId, 'author-1');
  assert.equal(result.fabricObj.lastEditorId, 'editor-1');
});

test('materializeFabricAnnotationFromYMap falls back to forEach fabric maps', () => {
  const fabric = {
    forEach(cb) {
      cb('rect', 'type');
      cb({ id: 'from-fabric' }, 'data');
    },
  };
  // Swap key/value order — forEach(value, key) in Yjs
  const fabricY = {
    forEach(cb) {
      cb('rect', 'type');
      cb({}, 'data');
    },
  };
  const anno = {
    get(key) {
      if (key === 'fabric') return fabricY;
      return null;
    },
  };
  const result = materializeFabricAnnotationFromYMap(anno, 'fallback-id');
  assert.equal(result.id, 'fallback-id');
  assert.equal(result.fabricObj.type, 'rect');
  assert.equal(result.fabricObj.data.id, 'fallback-id');
  assert.equal(result.pageNumber, 1);
});

test('materializeFabricAnnotationFromYMap tolerates toJSON and meta failures', () => {
  const fabric = {
    toJSON() {
      throw new Error('boom');
    },
    forEach(cb) {
      cb('path', 'type');
      cb({}, 'data');
    },
  };
  const anno = {
    get(key) {
      if (key === 'fabric') return fabric;
      if (key === 'meta') {
        throw new Error('meta boom');
      }
      return null;
    },
  };
  const result = materializeFabricAnnotationFromYMap(anno, 'id-2');
  assert.equal(result.id, 'id-2');
  assert.equal(result.fabricObj.type, 'path');
});
