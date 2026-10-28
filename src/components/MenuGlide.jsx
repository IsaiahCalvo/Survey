import { useEffect, useRef } from 'react';
import './MenuGlide.css';

// The rows a glide follows: any menu item or list option that is a direct
// child of the menu the glide sits in.
const ROW_SELECTOR = '[role="menuitem"], [role="option"], [role="menuitemradio"], [role="menuitemcheckbox"]';

/**
 * The hover strip of a drop-down (owner 2026-10-28, from the 21st.dev
 * "smooth dropdown" he picked): one soft strip with a short bar on its left
 * that glides to the row under the pointer, or to the row a key moved to,
 * instead of each row lighting on its own. A danger row (Delete) turns it
 * red. It fades out when the pointer leaves the menu.
 *
 * Put it as the FIRST child of the element that holds the rows; that element
 * must be positioned (a fixed menu card already is). Touch never shows it: a
 * finger gets the row's own press colour.
 */
export default function MenuGlide() {
  const ref = useRef(null);

  useEffect(() => {
    const glide = ref.current;
    const host = glide?.parentElement;
    if (!host) return undefined;
    let current = null;

    const rowFrom = (target) => {
      const row = target?.closest?.(ROW_SELECTOR);
      if (!row || row.parentElement !== host) return null;
      if (row.disabled || row.getAttribute('aria-disabled') === 'true') return null;
      return row;
    };
    const place = (row) => {
      if (row === current) return;
      const jump = !current;
      current = row;
      // The first row it lands on it appears at; after that it glides.
      glide.toggleAttribute('data-instant', jump);
      glide.toggleAttribute('data-danger', row.classList.contains('is-danger'));
      glide.style.width = `${row.offsetWidth}px`;
      glide.style.height = `${row.offsetHeight}px`;
      glide.style.transform = `translate(${row.offsetLeft}px, ${row.offsetTop}px)`;
      if (jump) void glide.offsetWidth;
      glide.setAttribute('data-on', '');
      if (jump) glide.removeAttribute('data-instant');
    };
    const hide = () => {
      current = null;
      glide.removeAttribute('data-on');
    };

    const onPointerOver = (event) => {
      if (event.pointerType === 'touch') return;
      const row = rowFrom(event.target);
      if (row) place(row);
    };
    const onPointerLeave = (event) => {
      if (event.pointerType === 'touch') return;
      // Keyboard focus keeps its row lit when the pointer wanders off.
      const focused = rowFrom(document.activeElement);
      if (focused && focused.matches(':focus-visible')) place(focused);
      else hide();
    };
    const onFocusIn = (event) => {
      const row = rowFrom(event.target);
      if (row && row.matches(':focus-visible')) place(row);
    };
    const onFocusOut = (event) => {
      if (!host.contains(event.relatedTarget) && !host.matches(':hover')) hide();
    };

    host.addEventListener('pointerover', onPointerOver);
    host.addEventListener('pointerleave', onPointerLeave);
    host.addEventListener('focusin', onFocusIn);
    host.addEventListener('focusout', onFocusOut);
    return () => {
      host.removeEventListener('pointerover', onPointerOver);
      host.removeEventListener('pointerleave', onPointerLeave);
      host.removeEventListener('focusin', onFocusIn);
      host.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  return (
    <span ref={ref} className="menu-glide" aria-hidden="true">
      <span className="menu-glide__bar" />
    </span>
  );
}
