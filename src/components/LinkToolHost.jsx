/* Nightly 'link-tool': the Hyperlink tool's viewer side.
 *   - Shift+H arms the tool (Drawboard's key).
 *   - A box dragged with it (SVGAnnotationLayer sends LINK_BOX_DRAWN_EVENT)
 *     opens "New hyperlink"; Create saves the link mark on that page.
 *     Cancel drops the box; nothing is saved.
 *   - Area: the dialog closes, a toast asks for the area, and the next box
 *     dragged (on any page of this file) is where the link opens. Esc, or
 *     putting the tool down, drops the pending link.
 *   - Link on the picked bar (LINK_EDIT_EVENT) opens "Edit hyperlink".
 * Rules and the mark: utils/linkTool.js. */
import { useCallback, useEffect, useRef, useState } from 'react';
import HyperlinkDialog from './HyperlinkDialog.jsx';
import { dismissToast, showToast } from '../utils/toast';
import { isTypingTarget } from '../utils/typingTarget.js';
import {
  LINK_BOX_DRAWN_EVENT,
  LINK_EDIT_EVENT,
  LINK_TOOL_ID,
  buildLinkMark,
  isLinkToolKey,
  readLinkLastLook,
  saveLinkLastLook,
} from '../utils/linkTool.js';

const AREA_TOAST_ID = 'link-tool-choose-area';

export default function LinkToolHost({
  isActive = true,
  readOnly = false,
  numPages = 1,
  activeTool,
  setActiveTool,
  selectedLink = null, // { id, link, style, color } for the one picked link mark
  onPatchSelectedLink = null,
}) {
  // { draft: { pageNumber, box, id, commit }, initial } while the dialog is open.
  const [dialog, setDialog] = useState(null);
  // { draft, style, color } while waiting for the area box.
  const choosingRef = useRef(null);
  const [choosing, setChoosing] = useState(false);

  const stopChoosing = useCallback(() => {
    choosingRef.current = null;
    setChoosing(false);
    dismissToast(AREA_TOAST_ID);
  }, []);

  useEffect(() => {
    if (!isActive) return undefined;
    const onBox = (event) => {
      const detail = event?.detail;
      if (!detail || typeof detail.commit !== 'function') return;
      const pending = choosingRef.current;
      if (pending) {
        stopChoosing();
        const mark = buildLinkMark({
          id: pending.draft.id,
          box: pending.draft.box,
          link: { kind: 'area', page: detail.pageNumber, rect: detail.box },
          style: pending.style,
          color: pending.color,
        });
        if (mark) pending.draft.commit(mark);
        return;
      }
      setDialog({ mode: 'create', draft: detail, initial: readLinkLastLook() });
    };
    window.addEventListener(LINK_BOX_DRAWN_EVENT, onBox);
    return () => window.removeEventListener(LINK_BOX_DRAWN_EVENT, onBox);
  }, [isActive, stopChoosing]);

  // Putting the tool down (or leaving the tab) drops a pending area pick.
  useEffect(() => {
    if (choosing && (activeTool !== LINK_TOOL_ID || !isActive)) stopChoosing();
  }, [activeTool, choosing, isActive, stopChoosing]);

  useEffect(() => {
    if (!isActive) return undefined;
    const onKey = (event) => {
      if (choosingRef.current && event.key === 'Escape') {
        event.preventDefault();
        stopChoosing();
        return;
      }
      if (readOnly || !isLinkToolKey(event) || isTypingTarget(event.target)) return;
      event.preventDefault();
      setActiveTool?.(LINK_TOOL_ID);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isActive, readOnly, setActiveTool, stopChoosing]);

  const selectedRef = useRef(selectedLink);
  selectedRef.current = selectedLink;
  useEffect(() => {
    if (!isActive) return undefined;
    const onEdit = () => {
      const picked = selectedRef.current;
      if (!picked || readOnly) return;
      setDialog({ mode: 'edit', initial: { link: picked.link, style: picked.style, color: picked.color } });
    };
    window.addEventListener(LINK_EDIT_EVENT, onEdit);
    return () => window.removeEventListener(LINK_EDIT_EVENT, onEdit);
  }, [isActive, readOnly]);

  // The open dialog, cleared at once on submit, so a second Enter before the
  // re-render can't commit the same link twice.
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const close = useCallback(() => setDialog(null), []);
  const submit = useCallback(({ link, pendingArea, style, color }) => {
    const current = dialogRef.current;
    dialogRef.current = null;
    setDialog(null);
    if (!current) return;
    if (current.mode === 'edit') {
      if (pendingArea) {
        showToast('To link to an area, draw a new link with the Hyperlink tool.', 'info');
        return;
      }
      onPatchSelectedLink?.({ link, style, color });
      return;
    }
    saveLinkLastLook({ style, color });
    if (pendingArea) {
      choosingRef.current = { draft: current.draft, style, color };
      setChoosing(true);
      showToast('Drag a box round the area the link should open.', 'success', { id: AREA_TOAST_ID, duration: Infinity });
      return;
    }
    const mark = buildLinkMark({ id: current.draft.id, box: current.draft.box, link, style, color });
    if (mark) current.draft.commit(mark);
  }, [onPatchSelectedLink]);

  return (
    <HyperlinkDialog
      open={Boolean(dialog)}
      mode={dialog?.mode || 'create'}
      initial={dialog?.initial || null}
      numPages={numPages}
      onSubmit={submit}
      onCancel={close}
    />
  );
}
