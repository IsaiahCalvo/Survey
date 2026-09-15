// Fixed server-private entry point. No caller code/path or inherited env/flags.
import { parentPort, workerData } from 'node:worker_threads';
import { prepareDocumentGenerationReplacement } from './documentGenerationReplacement.js';

try {
  const result = await prepareDocumentGenerationReplacement(workerData.input);
  // The pure preparation owns this fresh PDF buffer. Never transfer caller data.
  parentPort.postMessage({
    jobId: workerData.jobId,
    binding: {
      actorUserId: workerData.input.actorUserId,
      documentId: workerData.input.documentId,
      sourceId: workerData.input.sourceId,
      operationId: workerData.input.operationId,
      generationId: result.plan.source.generationId,
      walHead: result.plan.source.walHead,
      ...(workerData.input.targetContentModelVersion === 2 ? { targetContentModelVersion: 2 } : {}),
      ...(workerData.input.aggregateAdmissionVersion === 1 ? { aggregateAdmissionVersion: 1 } : {}),
    },
    result,
  }, [result.candidate.bytes.buffer]);
} catch {
  parentPort.postMessage({ jobId: workerData.jobId, error: 'DOCUMENT_GENERATION_REPLACEMENT_INVALID' });
} finally {
  parentPort.close();
}
