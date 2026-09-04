import { erasePageAnnotations } from '../utils/pageSpaceEraser.js';

self.onmessage = ({ data }) => {
  const { requestId, args, blockedByIndex = [] } = data || {};
  try {
    const rejectedAnnotations = [];
    const result = erasePageAnnotations({
      ...args,
      canErase: (object, index) => {
        const blocked = blockedByIndex[index];
        if (blocked) rejectedAnnotations.push(blocked);
        return !blocked;
      },
    });
    self.postMessage({
      requestId,
      result: { ...result, rejectedAnnotations },
    });
  } catch (error) {
    self.postMessage({ requestId, error: String(error?.message || error) });
  }
};
