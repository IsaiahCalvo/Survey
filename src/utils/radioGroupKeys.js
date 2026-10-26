// Arrow keys and Home/End move focus between a group's choices, as the old
// list menus did (AnnotationDropdown moveFocus); Enter and Space press the
// focused button.
const GROUP_KEYS = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
export function moveGroupFocus(event) {
  const buttons = [...event.currentTarget.querySelectorAll('[role="radio"]')];
  const index = buttons.indexOf(document.activeElement);
  if (index < 0) return;
  let next;
  if (event.key in GROUP_KEYS) next = (index + GROUP_KEYS[event.key] + buttons.length) % buttons.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = buttons.length - 1;
  else return;
  event.preventDefault();
  buttons[next].focus();
}
