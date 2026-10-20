import { isSamePageMutationVersion } from './pageMutationSource.js';
const shaOf = file => file?.contentSha256 || file?.content_sha256 || null;
export function captureTabSource(file) {
  return { file, version: { id: file?.id, contentSha256: shaOf(file) } };
}
export function isCurrentTabSource(origin, file) {
  if (!origin || !file) return false;
  const version = { id: file.id, contentSha256: shaOf(file) };
  return (origin.file === file && origin.version.contentSha256 === version.contentSha256)
    || isSamePageMutationVersion(origin.version, version);
}
