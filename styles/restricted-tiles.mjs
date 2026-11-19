export function restrictedTileOrigin(input) {
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && url.origin === input ? url.origin : null;
  } catch { return null; }
}

export function createRestrictedTiles({origin, window, fetcher, changed, report}) {
  let session, popup, popupWatch, expiry, lifetime;
  const api = path => `${origin}/restricted/${path}`;
  const request = (token, path, options = {}) => fetcher(api(path), {
    ...options, redirect: 'error', cache: 'no-store', credentials: 'omit', headers: {Authorization: 'Bearer ' + token},
  });
  function clear(message) {
    const previous = session;
    session = undefined;
    lifetime?.abort();
    window.clearTimeout(expiry);
    changed(null);
    if (message) report(message);
    return previous;
  }
  function endPopup() {
    window.clearInterval(popupWatch);
    popup?.close();
    popup = undefined;
  }
  window.addEventListener('message', event => {
    if (!popup || event.source !== popup || event.origin !== origin || event.data?.kind !== 'atlas-restricted-tiles') return;
    endPopup();
    const next = event.data.session;
    if (!/^[A-Za-z0-9_-]{43}$/.test(next?.token ?? '') ||
        !Number.isFinite(next.expiresAt) || next.expiresAt <= Date.now() ||
        !(next.soviet === true || next.google === true)) {
      report('This GitHub account could not unlock the restricted backgrounds.');
      return;
    }
    session = next;
    lifetime = new AbortController();
    const expired = () => clear('Session expired. Sign in again.');
    expiry = window.setTimeout(expired, Math.min(next.expiresAt - Date.now(), 15 * 60_000));
    report('Signed in. Restricted backgrounds are available when enabled.');
    changed({soviet: next.soviet === true, google: next.google === true});
  });
  return {
    signIn() {
      if (session || popup) return;
      popup = window.open(api('auth/login'), '_blank', 'popup,width=540,height=660');
      if (!popup) { report('Allow the sign-in popup and try again.'); return; }
      report('Waiting for GitHub sign-in…');
      popupWatch = window.setInterval(() => {
        if (popup.closed) {
          endPopup();
          report('Sign-in closed. Try again to unlock restricted backgrounds.');
        }
      }, 750);
    },
    signOut() {
      const previous = clear('Signed out.');
      if (previous) void request(previous.token, 'auth/session', {method: 'DELETE', signal: AbortSignal.timeout(5000)}).catch(() => {});
    },
    async fetch(path, options = {}) {
      const active = session;
      if (!active || active.expiresAt <= Date.now()) {
        if (active) clear('Session expired. Sign in again.');
        throw new Error('Restricted tile sign-in required');
      }
      if (!/^(?:soviet\/(?:1m|500k)\/(?:tiles\.json|\d+\/\d+\/\d+)|google\/(?:\d+\/\d+\/\d+|viewport\?[\w%.=+&-]+))$/.test(path))
        throw new Error('Unknown restricted tile route');
      const signal = AbortSignal.any([lifetime.signal, ...(options.signal ? [options.signal] : [])]);
      const response = await request(active.token, path, {...options, signal});
      if (active === session && response.status === 401) clear('Session expired. Sign in again.');
      return response;
    },
  };
}
