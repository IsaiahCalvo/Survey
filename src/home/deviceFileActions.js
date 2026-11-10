// Device files (Nightly flag device-files, 2026-11-10): open a PDF with no
// account, as Drawboard's "Temporary" files (drawboard-trial/file-model.md).
// services/deviceFiles.js keeps the PDF; the annotation store keeps its marks
// local-only under DEVICE_ACTOR_ID. This module is the glue the Documents
// list and the upload paths use.
import { useCallback, useEffect, useState } from 'react';
import { isFeatureOn, FLAGS_CHANGED_EVENT } from '../featureFlags.js';
import { showToast } from '../utils/toast';
import {
  deviceFiles,
  DEVICE_FILES_CHANGED_EVENT,
  DEVICE_ACTOR_ID,
  isDeviceDocumentId,
} from '../services/deviceFiles.js';

export const deviceFilesOn = () => isFeatureOn('device-files');

/**
 * Keep a browser File on this device and return a File the viewer can open
 * (id = the device id), or null when nothing can be kept (no IndexedDB).
 */
export async function keepFileOnDevice(file) {
  if (!file) return null;
  const row = await deviceFiles().add({ name: file.name, bytes: file });
  if (!row) return null;
  const opened = new File([file], row.name, { type: 'application/pdf' });
  opened.id = row.id;
  opened.deviceFile = true;
  opened.projectId = null;
  return opened;
}

/** A File for a device-file row, ready for the viewer; null if it is gone. */
export async function openDeviceFile(row) {
  const kept = await deviceFiles().read(row?.id);
  if (!kept) return null;
  const file = new File([kept.bytes], kept.row.name, { type: 'application/pdf' });
  file.id = kept.row.id;
  file.deviceFile = true;
  file.projectId = null;
  return file;
}

/* The marks of a device file as one Yjs update (empty update when none). */
async function readDeviceMarks(documentId) {
  const [{ openAnnotationDoc }, Y] = await Promise.all([
    import('../services/annotationDocSync.js'),
    import('yjs'),
  ]);
  const handle = await openAnnotationDoc({
    documentId,
    supabase: null,
    actorUserId: DEVICE_ACTOR_ID,
    enableRealtime: false,
  });
  try {
    return Y.encodeStateAsUpdate(handle.doc);
  } finally {
    await handle.destroy();
  }
}

/* Lay a device file's marks into a fresh cloud document as this user's own
   edits: the store's update observer appends them to the cloud log. */
async function carryMarksToCloud({ update, documentId, actorUserId, supabase }) {
  if (!update || update.byteLength <= 2) return true; // nothing drawn
  const [{ openAnnotationDoc }, Y] = await Promise.all([
    import('../services/annotationDocSync.js'),
    import('yjs'),
  ]);
  const handle = await openAnnotationDoc({ documentId, supabase, actorUserId, enableRealtime: false });
  try {
    Y.applyUpdate(handle.doc, update);
    await handle.drain();
    // One checkpoint holding everything, so the next open reads it at once.
    await handle.flushSnapshot().catch(() => false);
    return true;
  } finally {
    await handle.destroy();
  }
}

/**
 * Save a device file to the signed-in account: upload it the normal way
 * (`upload(file)` resolves to the new document id), carry its marks across,
 * then remove the device copy. The device copy is kept if anything fails.
 */
export async function saveDeviceFileToAccount({ row, user, supabase, upload }) {
  if (!row?.id || !user?.id || typeof upload !== 'function') return { ok: false };
  const kept = await deviceFiles().read(row.id);
  if (!kept) return { ok: false, reason: 'gone' };
  const update = await readDeviceMarks(row.id);
  const file = new File([kept.bytes], kept.row.name, { type: 'application/pdf' });
  const documentId = await upload(file);
  if (!documentId) return { ok: false, reason: 'upload' };
  await carryMarksToCloud({ update, documentId, actorUserId: user.id, supabase });
  await deviceFiles().remove(row.id);
  return { ok: true, documentId };
}

/* Delete acts at once with an Undo (the app's rule): the row hides now and
   the file goes after the toast's time, unless Undo is pressed. */
const DELETE_UNDO_MS = 6_000;
const hiddenIds = new Set();
const announce = () => {
  try { globalThis.dispatchEvent?.(new CustomEvent(DEVICE_FILES_CHANGED_EVENT)); } catch { /* no DOM */ }
};
export function deleteDeviceFile(row) {
  if (!row?.id || hiddenIds.has(row.id)) return;
  hiddenIds.add(row.id);
  announce();
  const timer = setTimeout(() => {
    deviceFiles().remove(row.id).finally(() => { hiddenIds.delete(row.id); announce(); });
  }, DELETE_UNDO_MS);
  showToast(`${row.name || 'Document'} deleted from this device`, 'info', {
    duration: DELETE_UNDO_MS,
    action: {
      label: 'Undo',
      onClick: () => { clearTimeout(timer); hiddenIds.delete(row.id); announce(); },
    },
  });
}

export const renameDeviceFile = (row, name) => deviceFiles().update(row?.id, { name });

/** Device-file rows for the Documents list, kept current. */
export function useDeviceFileRows() {
  const [enabled, setEnabled] = useState(deviceFilesOn);
  const [rows, setRows] = useState([]);
  useEffect(() => {
    const onFlags = () => setEnabled(deviceFilesOn());
    globalThis.addEventListener?.(FLAGS_CHANGED_EVENT, onFlags);
    return () => globalThis.removeEventListener?.(FLAGS_CHANGED_EVENT, onFlags);
  }, []);
  const reload = useCallback(() => {
    if (!enabled) { setRows([]); return; }
    deviceFiles().list()
      .then((list) => setRows(list.filter((row) => !hiddenIds.has(row.id))))
      .catch(() => setRows([]));
  }, [enabled]);
  useEffect(() => {
    reload();
    globalThis.addEventListener?.(DEVICE_FILES_CHANGED_EVENT, reload);
    return () => globalThis.removeEventListener?.(DEVICE_FILES_CHANGED_EVENT, reload);
  }, [reload]);
  return { enabled, rows };
}

export { isDeviceDocumentId };
