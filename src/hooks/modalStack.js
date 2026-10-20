/**
 * modalStack.js — the ONE list of open modal dialogs, oldest first (KAL-66).
 *
 * The app has two focus-trap hooks: src/hooks/useFocusTrap.js (most dialogs)
 * and src/home/useModalFocusTrap.js (Share, Documents details, Templates
 * editor — it also lets portalled pickers and menus keep focus). Each used to
 * keep its own list, so a dialog from one family opened over a dialog from
 * the other (Share over Manage access) had BOTH believing they were on top:
 * the one underneath pulled Tab focus back out of the one you were using.
 * Both hooks now push onto this list, and only the last entry answers Tab
 * and Escape. Entries are `{ containerRef }`.
 */
export const openModalStack = [];
