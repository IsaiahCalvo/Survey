/* Sheet register (Nightly flag 'sheet-register'): the server side. One read
   for the listed documents (list_sheet_register: picked discipline, open
   issues and tasks, uploader, version) and two writes, both through
   functions that check the caller can edit the document. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';

export async function listSheetRegister(client, ids) {
  const list = (ids || []).filter((id) => id && !String(id).startsWith('temp-') && !String(id).startsWith('device:'));
  if (!list.length) return new Map();
  const out = new Map();
  for (let i = 0; i < list.length; i += 1000) {
    const { data, error } = await client.rpc('list_sheet_register', { p_document_ids: list.slice(i, i + 1000) });
    if (error) throw error;
    for (const row of data || []) {
      out.set(row.document_id, {
        discipline: row.discipline || null,
        openItems: Number(row.open_items) || 0,
        uploaderName: row.uploader_name || null,
        version: Number(row.version) || 1,
      });
    }
  }
  return out;
}

export async function setDocumentDiscipline(client, documentId, discipline) {
  const { error } = await client.rpc('set_document_discipline', { p_document_id: documentId, p_discipline: discipline || null });
  if (error) throw error;
}

export async function setDocumentSheetDetails(client, documentId, { number, revision }) {
  const { error } = await client.rpc('set_document_sheet_details', {
    p_document_id: documentId,
    p_sheet_number: number || null,
    p_sheet_revision: revision || null,
  });
  if (error) throw error;
}

/**
 * The register rows of the listed documents, plus local writes laid over
 * them until the next read agrees: `extras` (id -> server row) and `edits`
 * (id -> { sheetNumber, revision } saved here but not yet in `documents`).
 */
export function useSheetRegister(enabled, ids, { client = supabase } = {}) {
  const [extras, setExtras] = useState(() => new Map());
  const [edits, setEdits] = useState(() => new Map());
  const key = enabled ? [...ids].sort().join(',') : '';
  const tickRef = useRef(0);
  const touchedRef = useRef(new Map());
  useEffect(() => {
    if (!key) return undefined;
    let live = true;
    const load = () => {
      const start = tickRef.current;
      listSheetRegister(client, key.split(','))
        .then((next) => {
          if (!live) return;
          setExtras((cur) => {
            const merged = new Map(next);
            // A local discipline change newer than this read stays.
            for (const [id, tick] of touchedRef.current) {
              if (tick > start && cur.has(id)) merged.set(id, { ...(next.get(id) || {}), discipline: cur.get(id).discipline });
            }
            return merged;
          });
        })
        .catch((err) => console.warn('[sheet-register]', err?.message || err));
    };
    load();
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [key, client]);

  const setDiscipline = useCallback(async (docIds, discipline) => {
    const value = discipline || null;
    const before = new Map();
    tickRef.current += 1;
    setExtras((cur) => {
      const next = new Map(cur);
      for (const id of docIds) {
        before.set(id, cur.get(id)?.discipline ?? null);
        touchedRef.current.set(id, tickRef.current);
        next.set(id, { openItems: 0, uploaderName: null, version: 1, ...cur.get(id), discipline: value });
      }
      return next;
    });
    const results = await Promise.allSettled(docIds.map((id) => setDocumentDiscipline(client, id, value)));
    const failed = docIds.filter((_, i) => results[i].status === 'rejected');
    if (failed.length) {
      setExtras((cur) => {
        const next = new Map(cur);
        for (const id of failed) next.set(id, { ...cur.get(id), discipline: before.get(id) ?? null });
        return next;
      });
    }
    return failed.length === 0;
  }, [client]);

  const saveDetails = useCallback(async (documentId, { number, revision }) => {
    await setDocumentSheetDetails(client, documentId, { number, revision });
    setEdits((cur) => new Map(cur).set(documentId, { sheetNumber: number || null, revision: revision || null }));
  }, [client]);

  return { extras, edits, setDiscipline, saveDetails };
}

/* Hands the CSV to the browser as a download (UTF-8 with a byte-order mark,
   so Excel reads accents and dashes right). */
export function downloadCsv(text, name) {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
