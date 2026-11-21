// Non-WebGL 2D raster slippy-map fallback for environments where WebGL cannot
// start (headless browsers, disabled GPU acceleration, software-only sessions).
// Uses standard HTML <img> tiles and DOM station markers without startup fetch()
// calls so existing startup isolation and error diagnostics remain intact.

const TILE_SIZE = 256;
const MIN_FALLBACK_ZOOM = 1;
const MAX_FALLBACK_ZOOM = 19;
const MAX_LAT = 85.05112878;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrapLng(lng) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

function lngLatToWorld(lng, lat, worldSize) {
  const rad = clamp(lat, -MAX_LAT, MAX_LAT) * (Math.PI / 180);
  const x = ((lng + 180) / 360) * worldSize;
  const y = (0.5 - Math.log((1 + Math.sin(rad)) / (1 - Math.sin(rad))) / (4 * Math.PI)) * worldSize;
  return { x, y };
}

function worldToLngLat(x, y, worldSize) {
  const lng = (x / worldSize) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / worldSize;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lng, lat: clamp(lat, -MAX_LAT, MAX_LAT) };
}

function makeLngLat(lng, lat) {
  return {
    lng,
    lat,
    wrap() {
      return makeLngLat(wrapLng(lng), lat);
    },
    toArray() {
      return [lng, lat];
    },
  };
}

export function fallbackTileSpec(settings, getGoogleTileUrl) {
  const background = settings?.background || 'map';
  const useGoogle =
    settings?.mapSource === 'google' &&
    typeof getGoogleTileUrl === 'function' &&
    ['map', 'satellite', 'hybrid'].includes(background);

  if (useGoogle) {
    const variant =
      background === 'map'
        ? settings?.googleTheme === 'terrain'
          ? 'terrain'
          : 'roadmap'
        : 'satellite';
    const urlCheck = getGoogleTileUrl(variant, 1, 0, 0);
    if (urlCheck) {
      return {
        id: `google-${variant}`,
        maxTileZoom: 20,
        attribution: 'Map data © Google · 2D raster compatibility mode',
        url: (z, x, y) => getGoogleTileUrl(variant, z, x, y),
      };
    }
  }

  if (background === 'soviet') {
    return {
      id: 'soviet',
      maxTileZoom: 13,
      attribution: 'Soviet topo: NaKarte (AtloMaps) · © OpenStreetMap contributors · 2D compatibility mode',
      url: (z, x, y) => `https://tiles.nakarte.me/topomapper/${z}/${x}/${y}`,
    };
  }

  if (background === 'satellite' || background === 'hybrid') {
    return {
      id: 'eox-satellite',
      maxTileZoom: 14,
      attribution: 'EOxCloudless 2025 (Copernicus Sentinel data) · © OpenStreetMap contributors · 2D compatibility mode',
      // EOxCloudless WMTS path uses {z}/{y}/{x}.jpg
      url: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/${z}/${y}/${x}.jpg`,
    };
  }

  return {
    id: 'osm-standard',
    maxTileZoom: 19,
    attribution: '© OpenStreetMap contributors (OSMF Standard tiles) · 2D compatibility mode',
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  };
}

export function createRasterFallbackMap({
  container,
  window: win = globalThis.window,
  document: doc = globalThis.document,
  initialCenter = [15, 23],
  initialZoom = 2,
  getSettings = () => ({ background: 'map', stations: true, language: 'local', detail: 0 }),
  getGoogleTileUrl = null,
  getMajorStations = () => [],
  displayName = p => p?.name || '',
  onSelectStation = () => {},
  onMove = () => {},
} = {}) {
  if (!container || !doc) return null;

  let centerLng = Number.isFinite(initialCenter?.[0]) ? initialCenter[0] : 15;
  let centerLat = clamp(Number.isFinite(initialCenter?.[1]) ? initialCenter[1] : 23, -MAX_LAT, MAX_LAT);
  let zoom = clamp(Number.isFinite(initialZoom) ? initialZoom : 2, MIN_FALLBACK_ZOOM, MAX_FALLBACK_ZOOM);

  const root = doc.createElement('div');
  root.className = 'raster-fallback-root';
  root.tabIndex = 0;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', '2D raster compatibility map (WebGL unavailable)');

  const tilePlane = doc.createElement('div');
  tilePlane.className = 'raster-fallback-tiles';

  const markerPlane = doc.createElement('div');
  markerPlane.className = 'raster-fallback-markers';

  const controls = doc.createElement('div');
  controls.className = 'raster-fallback-controls';

  const zoomInBtn = doc.createElement('button');
  zoomInBtn.type = 'button';
  zoomInBtn.textContent = '+';
  zoomInBtn.title = 'Zoom in';
  zoomInBtn.setAttribute('aria-label', 'Zoom in');

  const zoomOutBtn = doc.createElement('button');
  zoomOutBtn.type = 'button';
  zoomOutBtn.textContent = '−';
  zoomOutBtn.title = 'Zoom out';
  zoomOutBtn.setAttribute('aria-label', 'Zoom out');

  controls.append(zoomInBtn, zoomOutBtn);

  const attrib = doc.createElement('div');
  attrib.className = 'raster-fallback-attrib';

  root.append(tilePlane, markerPlane, controls, attrib);
  container.replaceChildren(root);

  const tileCache = new Map();

  function viewportSize() {
    const width = container.clientWidth || win?.innerWidth || 1000;
    const height = container.clientHeight || win?.innerHeight || 700;
    return { width: Math.max(64, width), height: Math.max(64, height) };
  }

  // MapLibre world size is 512 * 2^zoom; slippy 256px tiles at tileZ = zoom + 1
  // match MapLibre's ground scale.
  function worldPixelsForZoom(z = zoom) {
    return 512 * 2 ** z;
  }

  function projectPoint(lngLat) {
    const [lng, lat] = Array.isArray(lngLat) ? lngLat : [lngLat.lng, lngLat.lat];
    const { width, height } = viewportSize();
    const worldSize = worldPixelsForZoom();
    const centerPx = lngLatToWorld(centerLng, centerLat, worldSize);
    const pointPx = lngLatToWorld(lng, lat, worldSize);
    const wrappedDx =
      pointPx.x - centerPx.x - worldSize * Math.round((pointPx.x - centerPx.x) / worldSize);
    return {
      x: width / 2 + wrappedDx,
      y: height / 2 + (pointPx.y - centerPx.y),
    };
  }

  function unprojectPoint(point) {
    const px = Array.isArray(point) ? point[0] : point.x;
    const py = Array.isArray(point) ? point[1] : point.y;
    const { width, height } = viewportSize();
    const worldSize = worldPixelsForZoom();
    const centerPx = lngLatToWorld(centerLng, centerLat, worldSize);
    const targetX = centerPx.x + (px - width / 2);
    const targetY = clamp(centerPx.y + (py - height / 2), 0, worldSize);
    const { lng, lat } = worldToLngLat(targetX, targetY, worldSize);
    return makeLngLat(wrapLng(lng), lat);
  }

  function render() {
    const settings = getSettings() || {};
    const spec = fallbackTileSpec(settings, getGoogleTileUrl);
    attrib.textContent = spec.attribution;

    const { width, height } = viewportSize();
    const desiredTileZ = Math.max(0, Math.round(zoom + 1));
    const tileZ = Math.min(spec.maxTileZoom, desiredTileZ);
    const n = 2 ** tileZ;
    const displayTileSize = (worldPixelsForZoom(zoom) / n);
    const worldSize = n * displayTileSize;
    const centerPx = lngLatToWorld(centerLng, centerLat, worldSize);

    const leftWorld = centerPx.x - width / 2;
    const rightWorld = centerPx.x + width / 2;
    const topWorld = Math.max(0, centerPx.y - height / 2);
    const bottomWorld = Math.min(worldSize, centerPx.y + height / 2);

    const minTileX = Math.floor(leftWorld / displayTileSize);
    const maxTileX = Math.floor(rightWorld / displayTileSize);
    const minTileY = clamp(Math.floor(topWorld / displayTileSize), 0, n - 1);
    const maxTileY = clamp(Math.floor(bottomWorld / displayTileSize), 0, n - 1);

    const activeKeys = new Set();
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      for (let ty = minTileY; ty <= maxTileY; ty++) {
        const wrappedX = ((tx % n) + n) % n;
        const src = spec.url(tileZ, wrappedX, ty);
        if (!src) continue;
        const key = `${spec.id}:${tileZ}:${tx}:${ty}:${src}`;
        activeKeys.add(key);
        let img = tileCache.get(key);
        if (!img) {
          img = doc.createElement('img');
          img.className = 'raster-fallback-tile';
          img.alt = '';
          img.decoding = 'async';
          img.draggable = false;
          img.src = src;
          tilePlane.append(img);
          tileCache.set(key, img);
        }
        const left = Math.round(width / 2 + (tx * displayTileSize - centerPx.x));
        const top = Math.round(height / 2 + (ty * displayTileSize - centerPx.y));
        const sizePx = Math.ceil(displayTileSize);
        img.style.transform = `translate(${left}px, ${top}px)`;
        img.style.width = `${sizePx}px`;
        img.style.height = `${sizePx}px`;
      }
    }

    for (const [key, img] of tileCache) {
      if (!activeKeys.has(key)) {
        img.remove();
        tileCache.delete(key);
      }
    }

    markerPlane.replaceChildren();
    if (settings.stations !== false && settings.background !== 'satellite') {
      const features = getMajorStations() || [];
      const tierCutoff = zoom >= 7 ? 99 : Math.max(3, Math.floor(zoom + 1.5));
      let renderedCount = 0;
      for (const feature of features) {
        if (renderedCount >= 120) break;
        const coords = feature?.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;
        const tier = feature.properties?.tier ?? 7;
        if (tier > tierCutoff) continue;
        const pos = projectPoint(coords);
        if (pos.x < -24 || pos.x > width + 24 || pos.y < -24 || pos.y > height + 24) continue;

        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'fallback-station-btn';
        btn.style.left = `${Math.round(pos.x)}px`;
        btn.style.top = `${Math.round(pos.y)}px`;
        const name = displayName(feature.properties, settings.language) || feature.properties?.name || '';
        btn.title = name || 'Railway station';
        btn.setAttribute('aria-label', name ? `Station: ${name}` : 'Railway station');

        const dot = doc.createElement('span');
        dot.className = 'fallback-station-dot';
        btn.append(dot);

        if (name && (zoom >= 3.5 || tier <= 3)) {
          const label = doc.createElement('span');
          label.className = 'fallback-station-label';
          label.textContent = name;
          btn.append(label);
        }

        btn.addEventListener('click', event => {
          event.stopPropagation();
          onSelectStation({
            ...feature,
            kind: 'station',
            source: 'stationMajor',
          });
        });

        markerPlane.append(btn);
        renderedCount++;
      }
    }
  }

  function setCamera(options = {}) {
    if (options.center) {
      const [lng, lat] = Array.isArray(options.center)
        ? options.center
        : [options.center.lng, options.center.lat];
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        centerLng = wrapLng(lng);
        centerLat = clamp(lat, -MAX_LAT, MAX_LAT);
      }
    }
    if (Number.isFinite(options.zoom)) {
      zoom = clamp(options.zoom, MIN_FALLBACK_ZOOM, MAX_FALLBACK_ZOOM);
    }
    render();
    onMove();
  }

  zoomInBtn.addEventListener('click', event => {
    event.stopPropagation();
    setCamera({ zoom: zoom + 1 });
  });

  zoomOutBtn.addEventListener('click', event => {
    event.stopPropagation();
    setCamera({ zoom: zoom - 1 });
  });

  let dragStart = null;
  root.addEventListener('pointerdown', event => {
    if (event.target.closest?.('button')) return;
    dragStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      worldSize: worldPixelsForZoom(),
      startCenter: lngLatToWorld(centerLng, centerLat, worldPixelsForZoom()),
    };
    root.setPointerCapture?.(event.pointerId);
  });

  root.addEventListener('pointermove', event => {
    if (!dragStart || event.pointerId !== dragStart.pointerId) return;
    const dx = event.clientX - dragStart.x;
    const dy = event.clientY - dragStart.y;
    const nextX = dragStart.startCenter.x - dx;
    const nextY = clamp(dragStart.startCenter.y - dy, 0, dragStart.worldSize);
    const next = worldToLngLat(nextX, nextY, dragStart.worldSize);
    centerLng = wrapLng(next.lng);
    centerLat = next.lat;
    render();
    onMove();
  });

  const endDrag = event => {
    if (dragStart && event.pointerId === dragStart.pointerId) {
      dragStart = null;
    }
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  root.addEventListener(
    'wheel',
    event => {
      event.preventDefault();
      const delta = event.deltaY < 0 ? 0.5 : -0.5;
      setCamera({ zoom: zoom + delta });
    },
    { passive: false },
  );

  root.addEventListener('dblclick', event => {
    if (event.target.closest?.('button')) return;
    const rect = root.getBoundingClientRect();
    const clicked = unprojectPoint([event.clientX - rect.left, event.clientY - rect.top]);
    setCamera({ center: [clicked.lng, clicked.lat], zoom: zoom + 1 });
  });

  root.addEventListener('keydown', event => {
    const panStep = 80;
    const worldSize = worldPixelsForZoom();
    const current = lngLatToWorld(centerLng, centerLat, worldSize);
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const next = worldToLngLat(current.x - panStep, current.y, worldSize);
      setCamera({ center: [next.lng, next.lat] });
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      const next = worldToLngLat(current.x + panStep, current.y, worldSize);
      setCamera({ center: [next.lng, next.lat] });
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = worldToLngLat(current.x, clamp(current.y - panStep, 0, worldSize), worldSize);
      setCamera({ center: [next.lng, next.lat] });
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = worldToLngLat(current.x, clamp(current.y + panStep, 0, worldSize), worldSize);
      setCamera({ center: [next.lng, next.lat] });
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setCamera({ zoom: zoom + 1 });
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      setCamera({ zoom: zoom - 1 });
    }
  });

  const onWindowResize = () => render();
  win?.addEventListener?.('resize', onWindowResize);

  render();

  return {
    isFallback: true,
    getCenter: () => makeLngLat(centerLng, centerLat),
    getZoom: () => zoom,
    getBearing: () => 0,
    getPitch: () => 0,
    getProjection: () => ({ type: 'mercator' }),
    getContainer: () => container,
    getCanvas: () => root,
    project: projectPoint,
    unproject: unprojectPoint,
    jumpTo: setCamera,
    easeTo: setCamera,
    flyTo: setCamera,
    fitBounds(bounds, options = {}) {
      const [[west, south], [east, north]] = bounds;
      const midLng = (west + east) / 2;
      const midLat = (south + north) / 2;
      const { width, height } = viewportSize();
      const pad = (typeof options.padding === 'number' ? options.padding : 40) * 2;
      const spanLng = Math.max(0.001, Math.abs(east - west));
      const spanLat = Math.max(0.001, Math.abs(north - south));
      const zLng = Math.log2((Math.max(64, width - pad) * 360) / (512 * spanLng));
      const zLat = Math.log2((Math.max(64, height - pad) * 180) / (512 * spanLat));
      const maxZoom = Number.isFinite(options.maxZoom) ? options.maxZoom : 15;
      setCamera({
        center: [midLng, midLat],
        zoom: Math.min(maxZoom, zLng, zLat),
      });
    },
    refresh: render,
    resize: render,
    destroy() {
      win?.removeEventListener?.('resize', onWindowResize);
      root.remove();
      tileCache.clear();
    },
  };
}
