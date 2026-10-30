// src/components/DialogCard.jsx
//
// THE app's dialog look, in one place (owner 2026-10-26: "modals that pop up
// need to feel integrated into the project. They need to all follow the same
// design" - after the "template changed" dialog came up looking like no other).
//
// It is the shell ConfirmModal (src/home/BulkModals.jsx) has always drawn:
//
//   +--------------------------------------------+
//   | Title (16/700)                         [X] |
//   | message (12, --text-3)                     |
//   | ...body (optional)...                      |
//   +--------------------------------------------+  hairline
//   |                      [Cancel] [Primary]    |  footer bar, --surface-1
//   +--------------------------------------------+
//
// on the one scrim (--overlay-scrim + 8px blur), --surface-2 card, --border
// edge, --radius-dialog / --shadow-dialog, with the KAL-66 focus trap (Tab
// stays in, Escape closes, focus goes back to the opener) and MotionPresence's
// exit. Buttons are the hub button system: Cancel is `hub-btn`, the action is
// `hub-btn hub-btn--primary` (add `is-danger` for a destructive one), both
// `dialog-touch-pad`. tests/dialogConsistency.test.mjs keeps dialogs on it.

import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../home/HubShell';
import { C } from '../uiPalette';
import { useFocusTrap } from '../hooks/useFocusTrap';
import MotionPresence from './MotionPresence.jsx';
import { exitMs } from '../utils/motion.js';
import { useTooltip } from './Tooltip';

export const DIALOG_OVERLAY_STYLE = Object.freeze({
  position: 'fixed', inset: 0, background: C.scrim,
  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300,
  fontFamily: 'var(--font-ui)',
});

export const DIALOG_CARD_STYLE = Object.freeze({
  maxWidth: '92vw', maxHeight: 'calc(100dvh - 32px)', display: 'flex', flexDirection: 'column',
  boxSizing: 'border-box', background: C.card, border: `1px solid ${C.rule}`,
  borderRadius: 'var(--radius-dialog)', boxShadow: 'var(--shadow-dialog)', color: C.ink, overflow: 'hidden',
});

// The one text field inside a dialog (Rename, the themed prompt). 13px and
// 32px tall on a mouse; on a touch screen hub.css (.dialog-prompt-input) makes
// it 16px (iOS zooms the page on a smaller field) and 44px tall. Give the
// input className="dialog-prompt-input".
export const DIALOG_FIELD_STYLE = Object.freeze({
  display: 'block', width: '100%', height: 32, boxSizing: 'border-box', padding: '0 10px',
  background: C.deep, border: `1px solid ${C.ruleStrong}`, borderRadius: 'var(--radius-sm)',
  color: C.ink, fontSize: 13, fontFamily: 'inherit', outline: 'none',
});

// A field's name above it: sentence case, never ALL CAPS.
export const DIALOG_LABEL_STYLE = Object.freeze({ display: 'block', fontSize: 11, color: C.muted, marginBottom: 6 });

export const DIALOG_FOOTER_STYLE = Object.freeze({
  padding: '12px 16px', borderTop: `1px solid ${C.rule}`, background: C.deep,
  display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', flex: 'none',
});

/**
 * Most callers drop an open dialog from the page outright ({open && <Dialog>})
 * instead of passing open={false}, so MotionPresence never sees it close and
 * it vanished in one frame while it had faded in (frame captures, 2026-10-27).
 * Unmounted while open, a lifeless copy of the scrim and card is left where it
 * was, marked closing so motion.css plays the same exit, then removed.
 */
function playUnmountExit(overlay, parent) {
  const ms = exitMs('dialog');
  if (!overlay || !parent?.isConnected || ms <= 0) return;
  const copy = overlay.cloneNode(true);
  // Typed text lives in the property, not the attribute a copy carries.
  const from = [...overlay.querySelectorAll('input, textarea')];
  [...copy.querySelectorAll('input, textarea')].forEach((field, k) => { field.value = from[k]?.value ?? ''; });
  for (const node of [copy, ...copy.querySelectorAll('[id]')]) node.removeAttribute('id');
  copy.setAttribute('data-motion-state', 'closing');
  copy.setAttribute('data-motion-kind', 'dialog');
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute('inert', '');
  parent.appendChild(copy);
  setTimeout(() => copy.remove(), ms);
}

/**
 * @param {object} props
 * @param {boolean} [props.open=true]
 * @param {import('react').ReactNode} props.title
 * @param {import('react').ReactNode} [props.message] one short paragraph under the title
 * @param {() => void} props.onClose  X, Escape and the scrim
 * @param {() => void} [props.onScrim] a tap on the scrim, when it must differ
 *   from onClose (the prompt keeps typed text on a stray tap)
 * @param {boolean} [props.busy] while true nothing closes it
 * @param {number} [props.width=380]
 * @param {number} [props.zIndex] over the viewer's own layers when needed
 * @param {boolean} [props.atRoot] mount at the screen root: a card the viewer
 *   opens while a phone sheet is up, which inside the viewer sits in the work
 *   area's layer, under the sheet and the dock. Opt-in, because a panel that
 *   closes on a tap outside itself counts a tap in a root-mounted card as one.
 * @param {import('react').ReactNode} [props.children] the body, under the message
 * @param {import('react').ReactNode} [props.footer] the buttons, right-aligned
 * @param {'div'|'form'} [props.as='div'] a form submits on Enter
 * @param {'dialog'|'alertdialog'} [props.role='dialog'] alertdialog for a destructive warning
 * @param {object} [props.cardProps] extra props for the card (onSubmit, data-*)
 */
export default function DialogCard({
  open = true,
  title,
  message,
  ariaLabel,
  onClose,
  onScrim,
  busy = false,
  width = 380,
  zIndex,
  atRoot = false,
  children,
  footer,
  as: Card = 'div',
  role = 'dialog',
  cardProps,
}) {
  const tip = useTooltip();
  const cardRef = useRef(null);
  useFocusTrap(cardRef, open, { onEscape: busy ? undefined : onClose });
  const overlayRef = useRef(null);
  const shownRef = useRef(null); // { overlay, parent } while open
  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    shownRef.current = open && overlay ? { overlay, parent: overlay.parentNode } : null;
  });
  useLayoutEffect(() => () => {
    const shown = shownRef.current;
    if (shown) playUnmountExit(shown.overlay, shown.parent);
  }, []);

  // Closed: MotionPresence plays the exit of the last open card (motion.css).
  // An atRoot card lives at the screen root, closing too.
  const mount = (node) => (atRoot && typeof document !== 'undefined' && document.body ? createPortal(node, document.body) : node);
  if (!open) return mount(<MotionPresence open={false} />);

  const card = (
    <MotionPresence open>
      <div ref={overlayRef} onClick={busy ? undefined : (onScrim || onClose)} style={zIndex ? { ...DIALOG_OVERLAY_STYLE, zIndex } : DIALOG_OVERLAY_STYLE}>
        <Card
          ref={cardRef}
          role={role}
          aria-modal="true"
          aria-label={ariaLabel || (typeof title === 'string' ? title : undefined)}
          onClick={(e) => e.stopPropagation()}
          style={{ ...DIALOG_CARD_STYLE, width }}
          {...cardProps}
        >
          <div style={{ padding: '18px 18px 14px', display: 'flex', justifyContent: 'space-between', gap: 12, flex: 'none' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.015em' }}>{title}</div>
              {message && <div style={{ fontSize: 12, color: C.muted, marginTop: 8, lineHeight: 1.5 }}>{message}</div>}
            </div>
            <button type="button" disabled={busy} onClick={onClose} aria-label="Close" {...tip('Close')} className="hub-icon-btn"><Icon name="close" size={13} /></button>
          </div>
          {children ? (
            <div style={{ padding: '0 18px 16px', minHeight: 0, overflowY: 'auto', fontSize: 12, color: C.inkSoft, lineHeight: 1.5 }}>{children}</div>
          ) : null}
          {footer ? <div style={DIALOG_FOOTER_STYLE}>{footer}</div> : null}
        </Card>
      </div>
    </MotionPresence>
  );
  return mount(card);
}
