// Number of tracks running side by side, counted from the mapped geometry:
// OpenStreetMap maps each track as its own way, and the railway tiles carry
// no track-count tag. At points along each track a short probe is cast at
// right angles; tracks it crosses that run roughly parallel form a bundle
// when each lies within MAX_GAP of the next. A track's count is the median
// bundle size over its probes. Tracks in tunnels and trams are only
// compared with their own kind (group). One running line per bundle (the one
// nearest the bundle's middle; sidings and yards only if there is none) is
// marked for labelling.
export const MIN_ZOOM = 12; // tiles from zoom 12 include sidings and yards
const MAX_GAP = 12;          // metres between neighbouring tracks (island platforms included)
const PROBE = 200;           // metres each side of the track
const STEP = 60;             // metres between probes
const MAX_PROBES = 24;
const MAX_ANGLE = Math.sin(20 * Math.PI / 180);
const EARTH = 40075016.686;

// Metres per tile unit at the tile's centre latitude.
export function unitMetres(z, y, extent) {
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / 2 ** z)));
  return EARTH * Math.cos(lat) / (2 ** z * extent);
}

// lines: [{group, main, parts:[[[x,y],...], ...]}] in tile units; main is
// false for sidings, yards and other service tracks. Returns, per
// line, {tracks, label} (tracks 0 when not measurable).
export function countTracks(lines, metres) {
  const gap = MAX_GAP / metres, probe = PROBE / metres, step = STEP / metres;
  const segments = [], cell = probe, grid = new Map();
  lines.forEach((line, index) => {
    for (const part of line.parts) for (let i = 1; i < part.length; i++) {
      const [x1, y1] = part[i-1], [x2, y2] = part[i], length = Math.hypot(x2 - x1, y2 - y1);
      if (!length) continue;
      const s = {index, group: line.group, x1, y1, x2, y2, dx: (x2 - x1) / length, dy: (y2 - y1) / length};
      segments.push(s);
      for (let gx = Math.floor(Math.min(x1, x2) / cell); gx <= Math.floor(Math.max(x1, x2) / cell); gx++)
        for (let gy = Math.floor(Math.min(y1, y2) / cell); gy <= Math.floor(Math.max(y1, y2) / cell); gy++) {
          const key = gx * 65536 + gy;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(s);
        }
    }
  });
  return lines.map((line, index) => {
    // Probe positions spread evenly along the whole line.
    const pieces = [];
    let total = 0;
    for (const part of line.parts) for (let i = 1; i < part.length; i++) {
      const length = Math.hypot(part[i][0] - part[i-1][0], part[i][1] - part[i-1][1]);
      if (length) { pieces.push([part[i-1], part[i], total, length]); total += length; }
    }
    if (!total) return {tracks: 0, label: false};
    const count = Math.min(MAX_PROBES, Math.max(1, Math.floor(total / step)));
    const sizes = [];
    let central = 0;
    for (let k = 0; k < count; k++) {
      const at = total * (k + 0.5) / count;
      const [[ax, ay], [bx, by], start, length] = pieces.find(([, , s, l]) => at <= s + l) || pieces.at(-1);
      const f = (at - start) / length, px = ax + (bx - ax) * f, py = ay + (by - ay) * f;
      const dx = (bx - ax) / length, dy = (by - ay) / length, nx = -dy, ny = dx;
      // Offsets along the probe of parallel tracks it crosses, by line.
      const offsets = new Map([[index, 0]]);
      const seen = new Set();
      const x0 = px - nx * probe, x1 = px + nx * probe, y0 = py - ny * probe, y1 = py + ny * probe;
      for (let gx = Math.floor(Math.min(x0, x1) / cell); gx <= Math.floor(Math.max(x0, x1) / cell); gx++)
        for (let gy = Math.floor(Math.min(y0, y1) / cell); gy <= Math.floor(Math.max(y0, y1) / cell); gy++) {
          for (const s of grid.get(gx * 65536 + gy) || []) {
            if (s.index === index || s.group !== line.group || seen.has(s)) continue;
            seen.add(s);
            if (Math.abs(s.dx * dy - s.dy * dx) > MAX_ANGLE) continue; // not parallel
            // Probe P + t·n meets segment A + u·(B − A).
            const ex = s.x2 - s.x1, ey = s.y2 - s.y1, det = ex * ny - ey * nx;
            if (!det) continue;
            const qx = s.x1 - px, qy = s.y1 - py;
            const t = (ex * qy - ey * qx) / det, u = (nx * qy - ny * qx) / det;
            if (u < 0 || u > 1 || Math.abs(t) > probe) continue;
            if (!offsets.has(s.index) || Math.abs(t) < Math.abs(offsets.get(s.index))) offsets.set(s.index, t);
          }
        }
      // Grow the bundle outwards from this track while neighbours are close.
      const sorted = [...offsets].sort((a, b) => a[1] - b[1]);
      let lo = sorted.findIndex(([i]) => i === index), hi = lo;
      while (lo > 0 && sorted[lo][1] - sorted[lo-1][1] <= gap) lo--;
      while (hi < sorted.length - 1 && sorted[hi+1][1] - sorted[hi][1] <= gap) hi++;
      // Ways meeting end to end cross the probe at the same place: one track.
      const bundle = sorted.slice(lo, hi + 1).filter(([, t], i, all) => !i || t - all[i-1][1] > 0.8 / metres);
      sizes.push(bundle.length);
      const middle = (bundle[0][1] + bundle.at(-1)[1]) / 2;
      const running = bundle.filter(([i]) => lines[i].main !== false), candidates = running.length ? running : bundle;
      const nearest = candidates.reduce((best, entry) => Math.abs(entry[1] - middle) < Math.abs(best[1] - middle) ? entry : best);
      if (nearest[0] === index) central++;
    }
    sizes.sort((a, b) => a - b);
    return {tracks: sizes[Math.floor(sizes.length / 2)], label: central * 2 > count};
  });
}

// Railway tile features to countTracks input: present, non-ferry lines.
export function trackLines(features) {
  return features.map(f => {
    const p = f.properties;
    if (f.type !== 2 || (p.state || 'present') !== 'present' || p.feature === 'ferry') return null;
    return {group: `${p.feature === 'tram' ? 'tram' : 'rail'}${p.tunnel === true ? '-tunnel' : ''}`, main: !p.service,
      parts: f.loadGeometry().map(ring => ring.map(q => [q.x, q.y]))};
  });
}
