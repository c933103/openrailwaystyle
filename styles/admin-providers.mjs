export const ROAD_DEEMPHASIZED_STYLES = Object.freeze([
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ visibility: 'on' }, { color: '#e5ece1' }] },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry.fill', stylers: [{ color: '#f3f2ea' }] },
  { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#bfd8e0' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5c7c88' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#dfdace' }] },
  { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#e7e4dc' }] },
  { featureType: 'road.local', elementType: 'geometry.fill', stylers: [{ color: '#efede6' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.local', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#8a867c' }] },
  { featureType: 'road.highway', elementType: 'labels.text.stroke', stylers: [{ color: '#f4f3ec' }, { weight: 2 }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#949086' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.stroke', stylers: [{ color: '#f4f3ec' }, { weight: 2 }] },
  { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#616d69' }] },
]);

const mapsOrigin = 'https://tile.googleapis.com/';
const googleLayer = 'admin-google';
const nakarteLayer = 'admin-nakarte';
const signedInWindow = 12 * 60 * 60 * 1000;

export function ownerSessionEnd(result, user, ownerId) {
  const provider = result?.signInProvider;
  const ids = result?.claims?.firebase?.identities?.['github.com'] || [];
  const profile = user?.providerData?.find(p => p.providerId === 'github.com');
  if (provider !== 'github.com' || !profile || profile.uid !== ownerId || !ids.includes(ownerId)) return 0;
  const start = Date.parse(result.authTime);
  return Number.isFinite(start) ? start + signedInWindow : 0;
}

// The OAuth secret stays with Firebase. Only the provider's immutable GitHub
// numeric account ID is used to authorize the repository owner.
export async function loadOwnerAuth(config, changed) {
  const [{initializeApp}, sdk] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js'),
  ]);
  const app = initializeApp(config.firebase, 'atlas-administrator');
  const auth = sdk.getAuth(app);
  let revision = 0;
  sdk.onIdTokenChanged(auth, async user => {
    const request = ++revision;
    if (!user) { changed(0); return; }
    try {
      const end = ownerSessionEnd(await user.getIdTokenResult(), user, config.ownerId);
      if (request !== revision) return;
      if (end > Date.now()) changed(end);
      else { changed(0, 'Administrator sign-in was not accepted.'); await sdk.signOut(auth); }
    } catch { if (request === revision) changed(0, 'Administrator sign-in could not be verified.'); }
  }, () => changed(0, 'Administrator sign-in could not be verified.'));
  return {login: () => sdk.signInWithPopup(auth, new sdk.GithubAuthProvider()), logout: () => sdk.signOut(auth)};
}

export function viewportRanges(bounds) {
  const rawWest = bounds.getWest(), rawEast = bounds.getEast();
  if (Math.abs(rawEast - rawWest) >= 360) return [[-180,180]];
  const west = ((rawWest + 180) % 360 + 360) % 360 - 180;
  const east = west + ((rawEast - rawWest) % 360 + 360) % 360;
  return east > 180 ? [[west,180],[-180,east - 360]] : [[west,east]];
}

export function bindAdminProviders({document, window, settings, refresh, fetcher = fetch, loadAuth = loadOwnerAuth}) {
  const el = id => document.getElementById(id);
  const login = el('admin-login'), controls = el('admin-providers');
  const notice = el('admin-notice'), credit = el('google-map-credit');
  const imagery = el('map-provider'), historical = el('soviet-provider');
  const marker = 'atlas-admin-signin';
  let map, auth, config, preparing, expiry = 0, timer, googleView, googleSession, googlePending;
  let access = new AbortController(), viewport, desired = '', version = 0;
  const owner = () => Date.now() < expiry;
  const message = text => { notice.textContent = text; notice.hidden = !text; };
  function setAccess(end, reason) {
    clearTimeout(timer);
    expiry = end;
    const active = owner();
    if (active) timer = setTimeout(() => { setAccess(0); auth?.logout().catch(() => {}); }, end - Date.now());
    try { if (active) window.localStorage.setItem(marker,'1'); else window.localStorage.removeItem(marker); } catch {}
    controls.hidden = !active;
    login.textContent = active ? 'Administrator logout' : 'Administrator login';
    if (!active) {
      access.abort(); access = new AbortController();
      viewport?.abort(); version++; desired = '';
      historical.value = 'indian'; imagery.value = 'standard';
      settings.nakarte = false; settings.googleProvider = false;
      googleView = undefined; googleSession = undefined; googlePending = undefined;
      removeLayer(googleLayer); removeLayer(nakarteLayer); credit.hidden = true;
    }
    if (reason) message(reason);
    refresh();
  }
  async function prepare() {
    if (auth) return auth;
    if (!preparing) {
      preparing = (async () => {
        const result = await fetcher(new URL('./admin-config.json', import.meta.url), {cache:'no-store'});
        if (!result.ok) throw new Error('Administrator login has not been configured.');
        config = await result.json();
        if (!config.firebase?.apiKey || !config.firebase?.authDomain || !config.firebase?.projectId || !/^\d+$/.test(config.ownerId))
          throw new Error('Administrator login has not been configured.');
        auth = await loadAuth(config, setAccess);
        return auth;
      })().finally(() => { preparing = undefined; });
    }
    return preparing;
  }
  async function signIn() {
    login.disabled = true; message('');
    try {
      const service = await prepare();
      if (owner()) { setAccess(0); await service.logout(); }
      else await service.login();
    } catch (error) { message(error.code === 'auth/popup-closed-by-user' ? '' : error.message?.includes('not been configured') ? error.message : 'Administrator sign-in could not be completed.'); }
    finally { login.disabled = false; }
  }
  login.addEventListener('click', signIn);
  try { if (window.localStorage.getItem(marker)) prepare().catch(() => setAccess(0)); } catch {}
  const installed = new Set();
  function removeLayer(id) {
    if (!installed.delete(id)) return;
    if (map?.getLayer(id)) map.removeLayer(id);
    if (map?.getSource(id)) map.removeSource(id);
  }
  function layer(id, scheme, maxzoom, attribution) {
    if (installed.has(id)) return;
    const anchor = map.getStyle().layers.find(l => l.metadata?.['atlas:group'] === 'railway');
    if (!anchor) return;
    map.addSource(id, {type:'raster', tileSize:256, maxzoom, tiles:[scheme+'://{z}/{x}/{y}'], attribution});
    installed.add(id);
    map.addLayer({id,type:'raster',source:id, paint:{'raster-fade-duration':0},
      metadata:{'atlas:semantics-version':1,'atlas:runtime':true}}, anchor.id);
  }
  function googleURL(path, token) {
    const url = new URL(path, mapsOrigin);
    url.searchParams.set('key',config.googleMapsKey);
    if (token) url.searchParams.set('session',token);
    return url;
  }
  async function session(variant, language) {
    const key = variant + '/' + language;
    if (googleSession?.key === key && googleSession.expiry > Date.now()) return googleSession;
    if (googlePending?.key === key) return googlePending.promise;
    const signal = access.signal;
    const pending = {key};
    pending.promise = (async () => {
      const params = {mapType:variant,language,region:'US'};
      if (variant === 'roadmap') params.styles = ROAD_DEEMPHASIZED_STYLES;
      const result = await fetcher(googleURL('v1/createSession'), {method:'POST', credentials:'omit',
        headers:{'Content-Type':'application/json'},body:JSON.stringify(params),signal});
      if (!result.ok) throw new Error('Google Maps session was unavailable.');
      const data = await result.json();
      const expiry = Number(data.expiry) * 1000;
      if (!data.session || !Number.isFinite(expiry) || expiry <= Date.now()) throw new Error('Invalid Google Maps session.');
      signal.throwIfAborted();
      const opened = {token:data.session, expiry, key};
      if (googlePending === pending) googleSession = opened;
      return opened;
    })().finally(() => { if (googlePending === pending) googlePending = undefined; });
    googlePending = pending;
    return pending.promise;
  }
  function sync(force = false) {
    if (!map) return;
    const bg = settings.background;
    const useNakarte = owner() && historical.value === 'nakarte' && bg === 'soviet';
    if (useNakarte) layer(nakarteLayer, 'atlasnakarte', 13, 'AtloMaps');
    else removeLayer(nakarteLayer);
    settings.nakarte = useNakarte;
    const variant = owner() && imagery.value === 'google' && ['map','satellite','hybrid'].includes(bg)
      ? bg === 'map' ? 'roadmap' : 'satellite' : '';
    const language = settings.language === 'local' ? window.navigator.language || 'en' : settings.language;
    const target = variant ? variant + '/' + language : '';
    if (!force && desired === target) return;
    const changed = desired !== target;
    desired = target;
    const sequence = ++version;
    viewport?.abort();
    if (changed || !target) {
      googleView = undefined; settings.googleProvider = false; removeLayer(googleLayer); credit.hidden = true;
    }
    if (!target) return;
    const view = viewport = new AbortController();
    (async () => {
      if (!config?.googleMapsKey) throw new Error('Google Maps is not configured.');
      const active = await session(variant, language);
      view.signal.throwIfAborted();
      const bounds = map.getBounds(), zoom = Math.max(0, Math.min(22, Math.round(map.getZoom()+1)));
      const credits = await Promise.all(viewportRanges(bounds).map(async ([west,east]) => {
        const url = googleURL('tile/v1/viewport', active.token);
        for (const [key,value] of Object.entries({west,east,zoom,north:Math.min(90,bounds.getNorth()),south:Math.max(-90,bounds.getSouth())})) url.searchParams.set(key,value);
        const response = await fetcher(url,{credentials:'omit',signal:view.signal});
        if (!response.ok) throw new Error('Google Maps attribution was unavailable.');
        const {copyright} = await response.json();
        if (!copyright) throw new Error('Google Maps attribution was unavailable.');
        return copyright;
      }));
      if (sequence !== version || !owner()) return;
      googleView = {variant,language};
      el('google-credit-text').textContent = [...new Set(credits)].join(' · ');
      credit.hidden = false;
      settings.googleProvider = true;
      layer(googleLayer, 'atlasgoogle', 22, 'Google Maps');
      refresh();
    })().catch(error => {
      if (view.signal.aborted || sequence !== version) return;
      imagery.value = 'standard'; message(error.message); refresh();
    });
  }
  for (const select of [imagery, historical]) select.addEventListener('change', () => { if (owner()) { message(''); refresh(); } });
  return {
    prepareOnOpen() { if (!auth && !owner()) prepare().catch(() => {}); },
    sync,
    bind(mapInstance) { map = mapInstance; map.on('moveend', () => { if (desired) sync(true); }); },
    installProtocols(gl) {
      for (const name of ['atlasgoogle','atlasnakarte']) gl.addProtocol(name, async ({url}, {signal}) => {
        if (!owner()) throw new Error('Session ended.');
        const match = /^(?:atlasgoogle|atlasnakarte):\/\/(\d+)\/(\d+)\/(\d+)$/.exec(url);
        if (!match) throw new Error('Invalid tile.');
        const [z,x,y] = match.slice(1).map(Number);
        if (z > (name === 'atlasgoogle' ? 22 : 13) || x >= 2**z || y >= 2**z) throw new Error('Invalid tile.');
        const sessionSignal = access.signal;
        let target;
        if (name === 'atlasgoogle' && googleView && settings.googleProvider) {
          const active = await session(googleView.variant,googleView.language);
          target = googleURL('v1/2dtiles/'+[z,x,y].join('/'), active.token);
        } else if (name === 'atlasnakarte' && settings.nakarte) target = 'https://tiles.nakarte.me/topomapper/'+[z,x,y].join('/');
        else throw new Error('Provider is not selected.');
        if (!owner() || sessionSignal.aborted || signal.aborted) throw new Error('Request cancelled.');
        const response = await fetcher(target,{credentials:'omit',signal:AbortSignal.any([sessionSignal,signal]), ...(name === 'atlasgoogle' ? {cache:'no-store'} : {})});
        if (!response.ok) throw new Error('Tile service unavailable.');
        return {data:await response.arrayBuffer(), cacheControl:response.headers.get('Cache-Control')};
      });
    },
  };
}
