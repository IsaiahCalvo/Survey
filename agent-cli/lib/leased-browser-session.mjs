import { loadVerifiedTestAccounts } from '../../scripts/test-account-lease.mjs';

export async function installLeasedBrowserAccount(
  target,
  { accountIndex = 0, origin = null } = {},
) {
  // Lease verification runs synchronously before addInitScript yields, so a
  // missing/mismatched lease fails before the browser can navigate.
  const accounts = loadVerifiedTestAccounts({ minimumAccounts: accountIndex + 1 });
  const account = accounts[accountIndex];
  await target.addInitScript(({ credentials, origin }) => {
    if (origin && (window.location.origin !== origin || window.top !== window)) return;
    window.localStorage.setItem('__fix20AuthOverride', JSON.stringify(credentials));
  }, {
    credentials: { email: account.email, password: account.password },
    origin,
  });
  return account;
}

export async function assertBrowserUsesLeasedAccount(
  page,
  { account = null, accountIndex = 0, timeoutMs = 30_000 } = {},
) {
  const expected = account
    || loadVerifiedTestAccounts({ minimumAccounts: accountIndex + 1 })[accountIndex];
  await page.waitForFunction(
    ({ userId }) => {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key?.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
        try {
          const user = JSON.parse(window.localStorage.getItem(key))?.user;
          if (user?.id === userId) return true;
        } catch {
          // Keep looking for the active Supabase session.
        }
      }
      return false;
    },
    { userId: expected.userId },
    { timeout: timeoutMs },
  );
  return { email: expected.email, userId: expected.userId };
}
