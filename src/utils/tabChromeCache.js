// One bounded chrome snapshot per open tab. Functions read the newest API and
// only run for the active tab, even if a menu kept an older snapshot.
export function createTabChromeCache(isActive) {
  const tabs = new Map();
  const kinds = ['top', 'bottom', 'left', 'right'];
  const equal = (a, b) => a === b || (!!a && !!b
    && Object.keys(a).length === Object.keys(b).length
    && Object.keys(b).every(key => a[key] === b[key]));
  function entryFor(id) {
    if (!tabs.has(id)) tabs.set(id, { apis: {}, callbacks: {}, methods: new Map(), editorKey: null, editorMethods: new Map() });
    return tabs.get(id);
  }
  const atPath = (value, path) => path.split('.').reduce((current, part) => current?.[part], value);
  function wrap(id, kind, raw, entry, prefix = '', editorKey = null) {
    if (!raw) return raw;
    const wrapped = { ...raw };
    for (const key of Object.keys(raw)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof raw[key] === 'function') {
        const methodKey = `${kind}:${path}`;
        const methods = editorKey ? entry.editorMethods : entry.methods;
        if (!methods.has(methodKey)) methods.set(methodKey, (...args) => {
          if (tabs.get(id) !== entry || !isActive(id)
            || (editorKey && entry.editorKey !== editorKey)) return undefined;
          const latest = atPath(entry.apis[kind]?.raw, path);
          return typeof latest === 'function' ? latest(...args) : undefined;
        });
        wrapped[key] = methods.get(methodKey);
      } else if (path === 'regionToolbarApi' || path === 'surveyToolbar'
        || path === 'richTextEditor' || path === 'richTextEditor.api') {
        const scope = path.startsWith('richTextEditor') ? entry.editorKey : null;
        const next = wrap(id, kind, raw[key], entry, path, scope);
        const prev = atPath(entry.apis[kind]?.wrapped, path);
        wrapped[key] = equal(prev, next) ? prev : next;
      }
    }
    return wrapped;
  }
  return {
    callbacks(id, setters) {
      const entry = entryFor(id);
      for (const kind of kinds) if (!entry.callbacks[kind]) {
        entry.callbacks[kind] = update => {
          // Cleanup from a closed viewer cannot resurrect its cache.
          if (tabs.get(id) !== entry) return;
          const previous = entry.apis[kind];
          const raw = typeof update === 'function' ? update(previous?.raw ?? null) : update;
          if (kind === 'bottom') {
            const editorKey = raw?.richTextEditor?.sourceKey || raw?.richTextEditor?.api || null;
            if (entry.editorKey !== editorKey) {
              entry.editorKey = editorKey;
              entry.editorMethods.clear();
            }
          }
          const next = wrap(id, kind, raw, entry);
          const wrapped = equal(previous?.wrapped, next) ? previous.wrapped : next;
          entry.apis[kind] = { raw, wrapped };
          if (isActive(id)) setters[kind](current => equal(current, wrapped) ? current : wrapped);
        };
      }
      return entry.callbacks;
    },
    activate(id, setters) {
      for (const kind of kinds) setters[kind](tabs.get(id)?.apis[kind]?.wrapped ?? null);
    },
    retain(ids) {
      const open = new Set(ids);
      for (const [id, entry] of tabs) if (!open.has(id)) {
        entry.apis = {};
        entry.methods.clear();
        entry.editorMethods.clear();
        entry.editorKey = null;
        tabs.delete(id);
      }
    },
  };
}
