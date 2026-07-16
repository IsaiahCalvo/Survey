const isSameRedirectTarget = (candidate, expected) => {
  try {
    const actualUrl = new URL(candidate);
    const expectedUrl = new URL(expected);
    return actualUrl.protocol === expectedUrl.protocol
      && actualUrl.hostname === expectedUrl.hostname
      && actualUrl.port === expectedUrl.port
      && actualUrl.pathname === expectedUrl.pathname
      && actualUrl.username === expectedUrl.username
      && actualUrl.password === expectedUrl.password;
  } catch {
    return false;
  }
};

export async function completeSupabaseOAuthCallback(auth, callbackUrl, redirectUri) {
  if (!isSameRedirectTarget(callbackUrl, redirectUri)) {
    throw new Error('OAuth callback did not match the Survey app redirect');
  }

  const callback = new URL(callbackUrl);
  const hash = new URLSearchParams(callback.hash.replace(/^#/, ''));
  const oauthError = callback.searchParams.get('error') || hash.get('error');
  if (oauthError) {
    const description = callback.searchParams.get('error_description')
      || hash.get('error_description')
      || oauthError;
    throw new Error(description);
  }
  const code = callback.searchParams.get('code') || hash.get('code');
  if (code) {
    const { data, error } = await auth.exchangeCodeForSession(code);
    if (error) throw error;
    return data;
  }

  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  if (!accessToken || !refreshToken) {
    throw new Error('OAuth callback did not contain a complete session');
  }

  const { data, error } = await auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw error;
  return data;
}

export async function signInWithGoogleOAuth({ auth, currentUrl, openOAuthWindow = null }) {
  const isElectron = typeof openOAuthWindow === 'function';
  const redirectTo = isElectron
    ? String(currentUrl || '').split('#')[0]
    : new URL(currentUrl).origin;
  const { data, error } = await auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: isElectron,
    },
  });
  if (error) throw error;
  if (!isElectron) return data;
  if (!data?.url) throw new Error('Google sign-in did not return an authorization URL');

  const result = await openOAuthWindow(data.url, redirectTo);
  if (!result?.success || !result?.url) {
    throw new Error(result?.error || 'Google sign-in was cancelled');
  }
  return completeSupabaseOAuthCallback(auth, result.url, redirectTo);
}
