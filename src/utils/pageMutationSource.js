// Page operations accept the same local File or cloud descriptor as the viewer.
// Worker transfers must not detach a storage/cache adapter's retained bytes.
export async function readPageMutationBytes(file, readPdfBytes) {
  const value = typeof file?.arrayBuffer === 'function'
    ? await file.arrayBuffer()
    : typeof readPdfBytes === 'function'
    ? await readPdfBytes(file)
    : null;
  const bytes = typeof value?.arrayBuffer === 'function' ? await value.arrayBuffer() : value;
  if (bytes instanceof ArrayBuffer) return bytes.slice(0);
  if (ArrayBuffer.isView(bytes)) return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  throw new Error('PDF source bytes are not available for this page change');
}

// Metadata-only refreshes of our saved cloud version keep its Undo baseline.
export function isSamePageMutationVersion(left, right) {
  if (!left?.id || left.id !== right?.id) return false;
  if (left.contentSha256 || right.contentSha256) return Boolean(left.contentSha256 && left.contentSha256 === right.contentSha256);
  const path = file => file.supabaseFilePath || file.filePath;
  return Boolean(path(left) && path(left) === path(right) && left.size === right.size);
}
