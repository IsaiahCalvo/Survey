// Survey Nightly is for the people who run Survey and the testers they list at
// /flags (can_use_nightly() in the database). Anyone else who signs in here is
// sent back to surveytool.app. If the check fails or errors, fail closed so
// unapproved accounts are never admitted on a transient RPC failure (#1599).
const GATE_ID = 'survey-nightly-gate';
const STABLE_URL = 'https://surveytool.app';

function removeGate(doc) {
  doc.getElementById(GATE_ID)?.remove();
}

export function showNightlyGate(doc, { onSignOut } = {}) {
  if (doc.getElementById(GATE_ID)) return;
  const gate = doc.createElement('div');
  gate.id = GATE_ID;
  gate.setAttribute('role', 'dialog');
  gate.setAttribute('aria-modal', 'true');
  gate.setAttribute('aria-labelledby', `${GATE_ID}-title`);
  gate.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:#0d0f14;color:#f4f1ea;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;';
  gate.innerHTML = `
    <div style="max-width:420px;text-align:center">
      <h1 id="${GATE_ID}-title" style="font-size:22px;margin:0 0 8px">Survey Nightly is for testers</h1>
      <p style="margin:0 0 20px;color:#c9c4b8">This test copy has features that are not finished. Your account is not on the tester list, so use Survey instead.</p>
      <a href="${STABLE_URL}" style="display:inline-block;min-height:44px;line-height:44px;padding:0 20px;border-radius:6px;background:#6aa6f6;color:#0a1424;font-weight:600;text-decoration:none">Open Survey</a>
      <div><button type="button" style="margin-top:12px;min-height:44px;padding:0 16px;background:none;border:none;color:#c9c4b8;font:inherit;text-decoration:underline;cursor:pointer">Sign out</button></div>
    </div>`;
  const signOutBtn = gate.querySelector('button');
  signOutBtn.addEventListener('click', () => {
    signOutBtn.disabled = true;
    signOutBtn.textContent = 'Signing out…';
    Promise.resolve(onSignOut?.()).finally(() => {
      removeGate(doc);
    });
  });
  doc.body.appendChild(gate);
}

export async function signOutFromNightlyGate(supabase, storage = globalThis.localStorage) {
  // Prefer local scope so Sign out always clears the session and returns to
  // sign-in even when Supabase Auth /logout times out or returns 504.
  try {
    await supabase?.auth?.signOut?.({ scope: 'local' });
  } catch {
    try {
      await supabase?.auth?.signOut?.();
    } catch {
      // Fallback below clears any persisted Supabase auth token locally.
    }
  }
  try {
    if (storage && typeof storage.length === 'number') {
      const keys = [];
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (k && /^sb-.*-auth-token/i.test(k)) keys.push(k);
      }
      keys.forEach((k) => storage.removeItem(k));
    }
  } catch {
    // Storage may be unavailable in restricted contexts.
  }
}

export async function checkNightlyAccess(supabase, session) {
  if (!session?.user) return true;
  try {
    const { data, error } = await supabase.rpc('can_use_nightly');
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

export function installNightlyGate(supabase, doc = document) {
  if (!supabase?.auth) return;
  let latest = 0;
  const check = async (session) => {
    const run = ++latest;
    const allowed = await checkNightlyAccess(supabase, session);
    if (run !== latest) return;
    if (allowed) removeGate(doc);
    else showNightlyGate(doc, {
      onSignOut: async () => {
        latest += 1;
        await signOutFromNightlyGate(supabase);
        removeGate(doc);
      },
    });
  };
  supabase.auth.getSession?.().then(({ data }) => check(data?.session)).catch(() => {});
  supabase.auth.onAuthStateChange?.((event, session) => {
    if (
      event === 'SIGNED_IN'
      || event === 'SIGNED_OUT'
      || event === 'USER_UPDATED'
      || event === 'TOKEN_REFRESHED'
      || event === 'INITIAL_SESSION'
    ) {
      check(session);
    }
  });
}
