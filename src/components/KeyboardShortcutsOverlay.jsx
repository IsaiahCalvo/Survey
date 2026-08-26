/**
 * KeyboardShortcutsOverlay.jsx — self-toggling keyboard-shortcuts reference modal.
 *
 * Default-exports the KeyboardShortcutsOverlay component: holds its own open state,
 * toggled by '?' and closed by Escape (via useKeyPress). When open, renders an
 * overlay listing shortcuts grouped by Navigation/Actions/Interface, with the Find
 * modifier shown as ⌘ on Mac and Ctrl elsewhere. Stops wheel/touch events from
 * reaching the PDF handler so the list scrolls natively. Renders null when closed.
 */
import React from 'react';
import { COLORS, TYPOGRAPHY, BORDERS, SHADOWS } from '../theme';
import Icon from '../Icons';
import { useKeyPress } from '../utils/hooks';
import { useFocusTrap } from '../hooks/useFocusTrap';

/**
 * KeyboardShortcutsOverlay - Display keyboard shortcuts in an overlay
 * Press '?' to toggle
 */
const KeyboardShortcutsOverlay = () => {
  const [isOpen, setIsOpen] = React.useState(false);
  const modalContentRef = React.useRef(null);

  // useKeyPress ignores INPUT / TEXTAREA / contentEditable so `?` in zoom %
  // or Search stays in the field and does not toggle this overlay.
  useKeyPress('?', () => {
    setIsOpen((prev) => !prev);
  });

  // Accessibility: Tab stays inside the overlay, Escape closes it (this replaces
  // the old useKeyPress('Escape') — the trap listens in the capture phase so it
  // has to own Escape), and focus returns to whatever was focused before '?'.
  const closeOverlay = React.useCallback(() => setIsOpen(false), []);
  useFocusTrap(modalContentRef, isOpen, { onEscape: closeOverlay });

  // No floating hint pill — the overlay stays reachable via the '?' key, but
  // the bottom-right "Press ? for keyboard shortcuts" prompt is not shown.
  if (!isOpen) {
    return null;
  }

  const isMac = typeof navigator !== 'undefined' && /(Mac|iPhone|iPod|iPad)/i.test(`${navigator.platform || ''} ${navigator.userAgent || ''}`);
  const findShortcutModifier = isMac ? '⌘' : 'Ctrl';

  const shortcuts = [
    { category: 'Navigation', items: [
      { keys: ['←', '→'], description: 'Previous/Next page' },
      { keys: ['Home'], description: 'First page' },
      { keys: ['End'], description: 'Last page' },
      { keys: ['Ctrl', '+'], description: 'Zoom in' },
      { keys: ['Ctrl', '-'], description: 'Zoom out' },
      { keys: ['Ctrl', '0'], description: 'Fit page' },
      // Ctrl+0 / Ctrl+1 / Ctrl+2 are the three live fit-mode chords. The
      // overlay already listed Ctrl+0 Fit page next to Zoom in/out; omitting
      // the sibling Fit width / Fit height chords made them undiscoverable
      // from the catalog the same way Shift+E was missing next to E.
      { keys: ['Ctrl', '1'], description: 'Fit width' },
      { keys: ['Ctrl', '2'], description: 'Fit height' },
      // Ctrl+M is the live Manual lock chord (ZOOM_MODES.MANUAL at the
      // current scale). Fit options has no Manual button — this row only
      // lists the live chord next to the Fit siblings, the same leftover
      // class as Shift+E / Fit width.
      { keys: ['Ctrl', 'M'], description: 'Manual lock' },
    ]},
    { category: 'Actions', items: [
      { keys: ['Ctrl', 'O'], description: 'Open document' },
      // Ctrl+S is the live Save document chord (handleSaveDocument). The
      // overlay already listed Ctrl+O Open document and Ctrl+F Search text
      // in Actions; omitting the sibling Save chord made it undiscoverable
      // from the catalog the same way Ctrl+M was missing next to Fit height.
      // Do not invent Open file / UL-03 — Ctrl+O stays Electron File menu
      // only. Do not invent clipboard overlay rows.
      { keys: ['Ctrl', 'S'], description: 'Save document' },
      { keys: [findShortcutModifier, 'F'], description: 'Search text' },
    ]},
    // KAL-239: the tool keys were never listed here, so text selection (Shift+V)
    // would have been undiscoverable from the keyboard. Intended UX: every
    // single-key tool shortcut the viewer listens for is documented in one place,
    // with the two Select modes shown together so the pairing is obvious, and
    // Shift+E listed next to E the same way (Partial erase is a live chord).
    { category: 'Tools', items: [
      { keys: ['V'], description: 'Select annotations' },
      { keys: ['Shift', 'V'], description: 'Select text on the page' },
      { keys: ['P'], description: 'Pen' },
      { keys: ['H'], description: 'Highlighter' },
      { keys: ['E'], description: 'Eraser' },
      { keys: ['Shift', 'E'], description: 'Partial erase' },
      { keys: ['T'], description: 'Text' },
      { keys: ['Q'], description: 'Callout' },
      { keys: ['L'], description: 'Line' },
      { keys: ['A'], description: 'Arrow' },
      { keys: ['C'], description: 'Counter' },
    ]},
    { category: 'Interface', items: [
      { keys: ['B'], description: 'Toggle sidebar' },
      { keys: ['?'], description: 'Toggle shortcuts' },
      { keys: ['Esc'], description: 'Close dialogs/cancel' },
    ]},
  ];

  return (
    <div
      data-keyboard-shortcuts-modal="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: COLORS.background.overlay,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
      onClick={() => setIsOpen(false)}
    >
      <div
        ref={modalContentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        style={{
          background: COLORS.background.secondary,
          borderRadius: BORDERS.radius.xl,
          padding: '32px',
          maxWidth: '700px',
          width: '420px',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: SHADOWS.xl,
          border: `1px solid ${COLORS.border.default}`,
          scrollBehavior: 'smooth',
          WebkitOverflowScrolling: 'touch',
        }}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => {
          // Stop event from bubbling to PDF handler, but allow native smooth scrolling
          e.stopPropagation();
          // Don't preventDefault - let native browser scrolling work smoothly
          // The PDF handler already checks for modal and returns early, so this is safe
        }}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '24px',
          }}
        >
          <h2
            id="keyboard-shortcuts-title"
            style={{
              margin: 0,
              fontSize: TYPOGRAPHY.fontSize['2xl'],
              fontWeight: TYPOGRAPHY.fontWeight.semibold,
              color: COLORS.text.secondary,
              fontFamily: TYPOGRAPHY.fontFamily.default,
            }}
          >
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: COLORS.text.muted,
              cursor: 'pointer',
              padding: '4px',
              borderRadius: BORDERS.radius.sm,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = COLORS.background.elevated;
              e.currentTarget.style.color = COLORS.text.tertiary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = COLORS.text.muted;
            }}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Shortcuts List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {shortcuts.map((section, idx) => (
            <div key={idx}>
              <h3
                style={{
                  margin: '0 0 16px 0',
                  fontWeight: TYPOGRAPHY.fontWeight.semibold,
                  color: COLORS.text.tertiary,
                  fontFamily: TYPOGRAPHY.fontFamily.default,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontSize: TYPOGRAPHY.fontSize.sm,
                }}
              >
                {section.category}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {section.items.map((item, itemIdx) => (
                  <div
                    key={itemIdx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px',
                      background: COLORS.background.tertiary,
                      borderRadius: BORDERS.radius.md,
                      border: `1px solid ${COLORS.border.default}`,
                    }}
                  >
                    <div
                      style={{
                        fontSize: TYPOGRAPHY.fontSize.md,
                        color: COLORS.text.tertiary,
                        fontFamily: TYPOGRAPHY.fontFamily.default,
                      }}
                    >
                      {item.description}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      {item.keys.map((key, keyIdx) => (
                        <React.Fragment key={keyIdx}>
                          {keyIdx > 0 && (
                            <span
                              style={{
                                color: COLORS.text.disabled,
                                fontSize: TYPOGRAPHY.fontSize.sm,
                                margin: '0 2px',
                              }}
                            >
                              +
                            </span>
                          )}
                          <kbd
                            style={{
                              padding: '4px 8px',
                              background: COLORS.background.dark,
                              border: `1px solid ${COLORS.border.default}`,
                              borderRadius: BORDERS.radius.sm,
                              fontSize: TYPOGRAPHY.fontSize.base,
                              fontWeight: TYPOGRAPHY.fontWeight.semibold,
                              color: COLORS.text.secondary,
                              fontFamily: TYPOGRAPHY.fontFamily.mono,
                              minWidth: '32px',
                              textAlign: 'center',
                            }}
                          >
                            {key}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcutsOverlay;
