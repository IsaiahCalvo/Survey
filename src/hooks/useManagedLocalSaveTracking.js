import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const signatureOf = snapshot => JSON.stringify(snapshot?.entries);

// Only the managed local path uses this baseline. Sidebar hydration runs in
// effects, and native PDF import can reorder restored objects asynchronously.
// Wait for the import's explicit completion and following commit, not a timer.
export function useManagedLocalSaveTracking({ file, pdfId, snapshot, hydrated = true }) {
  const documentId = snapshot && pdfId === file?.localId ? pdfId : null;
  const [hydratedId, setHydratedId] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const previousFileRef = useRef(null);
  const currentRef = useRef(null);
  const signature = useMemo(() => signatureOf(snapshot), [snapshot]);
  currentRef.current = { file, documentId };

  useEffect(() => { setHydratedId(hydrated ? documentId : null); }, [documentId, hydrated]);
  useEffect(() => {
    if (!hydrated || !documentId || hydratedId !== documentId) return;
    if (baseline?.documentId !== documentId) {
      setBaseline({ documentId, signature });
    } else if (previousFileRef.current !== file && file._localDocumentState) {
      // An atomic page replacement carries its own committed state baseline.
      setBaseline({ documentId, signature: signatureOf(file._localDocumentState) });
    }
    previousFileRef.current = file;
  }, [documentId, hydratedId, hydrated, file, signature, baseline?.documentId]);

  const markSaved = useCallback((savedFile, savedSnapshot, currentSnapshot) => {
    const current = currentRef.current;
    if (current?.file !== savedFile || current.documentId !== savedSnapshot?.pdfId) return false;
    const savedSignature = signatureOf(savedSnapshot);
    setBaseline({ documentId: current.documentId, signature: savedSignature });
    return savedSignature === signatureOf(currentSnapshot);
  }, []);

  const ready = hydrated && !!documentId && hydratedId === documentId && baseline?.documentId === documentId;
  return { ready, dirty: ready && signature !== baseline.signature, markSaved };
}

// Keep a deadline while dirty instead of debouncing it on each annotation edit.
// The latest callback supplies current state; one pending local write owns a tick.
export function useManagedLocalAutoSave({ file, enabled, save }) {
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!enabled) return;
    let pending = false;
    let retired = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      Promise.resolve().then(() => { if (!retired) return saveRef.current(true); }).catch(() => {
        // The save callback owns visible errors and must retain the dirty flag.
      }).finally(() => { pending = false; });
    }, 30000);
    return () => { retired = true; clearInterval(timer); };
  }, [file, enabled]);
}
