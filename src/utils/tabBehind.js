// A document tab behind the front one (docs/TAB-SWITCHING.md, S9).
//
// Every open tab keeps its viewer mounted. A tab behind is hidden with
// `content-visibility: hidden` instead of `display: none`: the browser keeps
// its styles and layout, so bringing it to the front restyles a few hundred
// elements instead of the whole tab (~12k on a 36-sheet set). Its contents
// are not focusable, Tab skips them, focus inside is dropped when it goes
// behind and screen readers do not see them. `clip-path` stops its own box
// painting or taking clicks. It is also moved far off screen, so a "is the
// pointer over this page?" check in a tab behind never matches (with
// `display: none` its rects were all zero). Keys still reach document
// listeners, so a tab's own key handlers return early when it is behind.
//
// Not `inert` and not `visibility`: both are inherited, so toggling either
// restyles every element in the tab, which is the cost this avoids.
//
// The catch: unlike `display: none`, its elements still report real sizes.
// Code that picks "the" page or viewer by size or "is it shown" must look
// under its own tab's root, or skip anything in a tab behind
// (`isInTabBehind`, `queryFrontTab`), and a tab behind must not refit or draw
// because its viewer now has a size. Reading a size in a tab behind also
// forces a layout of that tab.

export const TAB_BEHIND_ATTR = 'data-tab-behind';

// Browsers without content-visibility (iOS before 18) fall back to
// display: none, which needs none of the above.
const SUPPORTS_CONTENT_VISIBILITY = typeof CSS !== 'undefined'
  && typeof CSS.supports === 'function'
  && CSS.supports('content-visibility', 'hidden');

const BEHIND_STYLE = Object.freeze(SUPPORTS_CONTENT_VISIBILITY
  ? { display: 'block', contentVisibility: 'hidden', clipPath: 'inset(100%)', transform: 'translateX(-1000000px)' }
  : { display: 'none' });
const FRONT_STYLE = Object.freeze({ display: 'block' });

/** The hiding part of a tab wrapper's style. */
export function tabWrapperHiding(visible) {
  return visible ? FRONT_STYLE : BEHIND_STYLE;
}

/** True when the node sits inside a tab that is behind the front one. */
export function isInTabBehind(node) {
  const element = node && node.nodeType === 1 ? node : node?.parentElement;
  return !!element?.closest?.(`[${TAB_BEHIND_ATTR}]`);
}

/**
 * The first element for `selector` that is not in a tab behind: the front
 * tab's (or the shell's). For shared code that cannot reach a tab's own root.
 */
export function queryFrontTab(selector, root = typeof document !== 'undefined' ? document : null) {
  for (const element of root?.querySelectorAll?.(selector) || []) {
    if (!isInTabBehind(element)) return element;
  }
  return null;
}
