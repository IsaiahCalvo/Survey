import { erasePageAnnotations } from './pageSpaceEraser.js';

export function planPageEraserPreview(options = {}) {
  const result = erasePageAnnotations(options);
  return {
    shouldPreview: result.didChange,
    partialIds: result.changedIds,
    atomicIds: result.deletedIds,
    result,
  };
}
