/**
 * annotationBatching.js — splits annotation rows into fixed-size upsert batches.
 *
 * Exports DEFAULT_ANNOTATION_UPSERT_BATCH_SIZE (250) and chunkRowsForAnnotationUpsert(),
 * which slices an array of rows into chunks so Supabase upserts stay under payload
 * limits during annotation cloud sync.
 */
const DEFAULT_ANNOTATION_UPSERT_BATCH_SIZE = 250;

export function chunkRowsForAnnotationUpsert(rows, batchSize = DEFAULT_ANNOTATION_UPSERT_BATCH_SIZE) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeBatchSize = Math.max(1, Number(batchSize) || DEFAULT_ANNOTATION_UPSERT_BATCH_SIZE);
  const chunks = [];
  for (let i = 0; i < safeRows.length; i += safeBatchSize) {
    chunks.push(safeRows.slice(i, i + safeBatchSize));
  }
  return chunks;
}
