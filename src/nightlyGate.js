// Survey Nightly is for the people who run Survey and the testers they list at
// /flags (can_use_nightly() in the database). Anyone else who signs in here is
// sent back to surveytool.app. If the check itself fails (offline, an older
// database) the app stays open: this keeps strangers off beta features, it is
// not what protects data.
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
      <a href="${STABLE_URL}" style="display:inline-block;min-height:44px;line-height:44px;padding:0 20px;border-radius:6px;background:#d8a84e;color:#1a1408;font-weight:600;text-decoration:none">Open Survey</a>
      <div><button type="button" style="margin-top:12px;min-height:44px;padding:0 16px;background:none;border:none;color:#c9c4b8;font:inherit;text-decoration:underline;cursor:pointer">Sign out</button></div>
    </div>`;
  gate.querySelector('button').addEventListener('click', () => { onSignOut?.(); });
  doc.body.appendChild(gate);
}

export async function checkNightlyAccess(supabase, session) {
  if (!session?.user) return true;
  try {
    const { data, error } = await supabase.rpc('can_use_nightly');
    if (error) return true;
    return data !== false;
  } catch {
    return true;
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
    else showNightlyGate(doc, { onSignOut: () => supabase.auth.signOut().catch(() => {}) });
  };
  supabase.auth.getSession?.().then(({ data }) => check(data?.session)).catch(() => {});
  supabase.auth.onAuthStateChange?.((event, session) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') check(session);
  });
}
