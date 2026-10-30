// Every open document tab stays mounted, and each AppShell render (a tool
// switch, a zoom step, the front tab's chrome) used to render every tab's
// whole viewer. A tab behind skips those renders while its own props are
// unchanged; the front tab, and a tab coming to or leaving the front, renders
// exactly as before. Props handed to the viewer must therefore keep their
// identity across renders (stable handlers, no inline functions or objects).
export function behindTabPropsEqual(prev, next) {
  if (prev.isActive || next.isActive) return false;
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(prev).length) return false;
  return keys.every((key) => Object.is(prev[key], next[key]));
}
