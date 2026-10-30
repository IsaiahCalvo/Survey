/**
 * TabChromeSlot - one open tab's copy of a rail, kept mounted while another
 * tab is in front.
 *
 * Owner 2026-10-27 ("the top, left and right rails need to be solid without
 * flickering"): the rails used to be keyed by document, so every tab switch
 * tore the left rail and the Survey rail down and built them again - the open
 * panel slid in again, thumbnails reloaded and the switch took longer. Now
 * each tab owns its rails the way it owns its viewer, and a switch only
 * changes which slot is drawn, in the same frame as the document. Rules:
 * docs/TAB-SWITCHING.md.
 *
 * The active slot adds no box (display: contents), so the rail lays out in its
 * host exactly as before; a hidden slot is display: none.
 */
export default function TabChromeSlot({ tabId, active, children }) {
  return (
    <div
      data-chrome-tab-slot={tabId}
      data-active={active ? 'true' : 'false'}
      style={{ display: active ? 'contents' : 'none' }}
    >
      {children}
    </div>
  );
}
