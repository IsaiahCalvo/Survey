// Stable callbacks for an API object published up to a parent's state.
//
// A child that publishes `{ ...state, onX: handler }` through a parent setter
// in an effect re-publishes whenever a handler's identity changes; if the
// parent's re-render recreates those handlers, the effect loops ("Maximum
// update depth exceeded"). Publish these wrappers instead: their identity is
// fixed for the life of the ref and each call runs the latest handler.
export function createStableActions(ref, names) {
  const actions = {};
  for (const name of names) {
    actions[name] = (...args) => {
      const handler = ref.current?.[name];
      return typeof handler === 'function' ? handler(...args) : undefined;
    };
  }
  return actions;
}
