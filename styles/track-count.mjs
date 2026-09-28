// Number of running tracks side by side, counted from the mapped geometry:
// OpenStreetMap maps each track as its own way, and the railway tiles carry
// no track-count tag.
// - Only running tracks count: sidings, yards, spurs and other service
//   tracks (tagged service=*) are left out, as are short ways at an angle
//   (crossovers and turnouts), which would otherwise add a track between
//   the two they join.
// - Along each running track a short probe is cast at right angles every
//   STEP metres; running tracks it crosses that run parallel form a bundle
//   while each lies within MAX_GAP of the next. Tunnels and trams are only
//   compared with their own kind (group).
// - The count is taken where it is measured, not for a whole way: one way
//   can run beside a double track for a while and alone after. Along each
//   track the counts are smoothed (median of three probes), and where the
//   track is its bundle's middle one (one per bundle, the same for every
//   member), stretches of equal count give label points, at the middle of
//   the stretch and every LABEL_EVERY metres along it.
export const MIN_ZOOM = 13; // below this, tile coordinates are too coarse (over 1 m) for tracks 4–5 m apart
const MAX_GAP = 12;          // metres between neighbouring tracks (island platforms included)
const PROBE = 120;           // metres each side of the track
const STEP = 40;             // metres between probes
const MAX_PROBES = 400;
const MAX_ANGLE = Math.sin(15 * Math.PI / 180);
const SHORT = 150;           // metres: shorter ways count only if nearly parallel (crossovers are short and angled)
const SHORT_ANGLE = Math.sin(2 * Math.PI / 180);
const LABEL_EVERY = 800;     // metres between labels on one stretch
const EARTH = 40075016.686;

// Metres per tile unit at the tile's centre latitude.
export function unitMetres(z, y, extent) {
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / 2 ** z)));
  return EARTH * Math.cos(lat) / (2 ** z * extent);
}

// Length of the way: as mapped (way_length, metres) when the tile gives it,
// else of its part in the tile.
const lengthOf = parts => parts.reduce((sum, part) => sum + part.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - part[i][0], p[1] - part[i][1]), 0), 0);

// lines: [{group, main, length?, parts:[[[x,y],...], ...]}] in tile units;
// main is false for sidings, yards and other service tracks; length is the
// whole way's length in metres, if known. Returns {lines, points}:
// per line {tracks} (the most common count along it, 0 when not measured,
// as for service tracks), and label points [{x, y, tracks, group}] in tile
// units.
export function countTracks(lines, metres) {
  const gap = MAX_GAP / metres, probe = PROBE / metres, step = STEP / metres, short = SHORT / metres;
  const lengths = lines.map(line => line.length > 0 ? line.length / metres : lengthOf(line.parts));
  const segments = [], cell = probe, grid = new Map();
  lines.forEach((line, index) => {
    if (line.main === false) return;
    for (const part of line.parts) for (let i = 1; i < part.length; i++) {
      const [x1, y1] = part[i-1], [x2, y2] = part[i], length = Math.hypot(x2 - x1, y2 - y1);
      if (!length) continue;
      const s = {index, group: line.group, short: lengths[index] < short, x1, y1, x2, y2, dx: (x2 - x1) / length, dy: (y2 - y1) / length};
      segments.push(s);
      for (let gx = Math.floor(Math.min(x1, x2) / cell); gx <= Math.floor(Math.max(x1, x2) / cell); gx++)
        for (let gy = Math.floor(Math.min(y1, y2) / cell); gy <= Math.floor(Math.max(y1, y2) / cell); gy++) {
          const key = gx * 65536 + gy;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(s);
        }
    }
  });
  // One probe: the bundle size at point p on `index`, heading d, and
  // whether `index` is the bundle's middle track. strict: only neighbours
  // within SHORT_ANGLE count.
  const measure = (index, group, px, py, dx, dy, strict = false) => {
    const nx = -dy, ny = dx, offsets = new Map([[index, 0]]), seen = new Set();
    const x0 = px - nx * probe, x1 = px + nx * probe, y0 = py - ny * probe, y1 = py + ny * probe;
    for (let gx = Math.floor(Math.min(x0, x1) / cell); gx <= Math.floor(Math.max(x0, x1) / cell); gx++)
      for (let gy = Math.floor(Math.min(y0, y1) / cell); gy <= Math.floor(Math.max(y0, y1) / cell); gy++) {
        for (const s of grid.get(gx * 65536 + gy) || []) {
          if (s.index === index || s.group !== group || seen.has(s)) continue;
          seen.add(s);
          const sine = Math.abs(s.dx * dy - s.dy * dx);
          if (sine > (s.short || strict ? SHORT_ANGLE : MAX_ANGLE)) continue; // not parallel, or a crossover
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
    // The middle track: nearest the bundle's centre; between two equally
    // near, the lower index, so every member picks the same one whichever
    // way it was drawn.
    const middle = (bundle[0][1] + bundle.at(-1)[1]) / 2, tie = 0.5 / metres;
    let best = bundle[0];
    for (const entry of bundle.slice(1)) {
      const d = Math.abs(entry[1] - middle), b = Math.abs(best[1] - middle);
      if (d < b - tie || (Math.abs(d - b) <= tie && entry[0] < best[0])) best = entry;
    }
    return {count: bundle.length, central: best[0] === index};
  };
  const points = [];
  const result = lines.map((line, index) => {
    // Service tracks are not counted.
    if (line.main === false) return {tracks: 0};
    const pieces = [];
    let total = 0;
    for (const part of line.parts) for (let i = 1; i < part.length; i++) {
      const length = Math.hypot(part[i][0] - part[i-1][0], part[i][1] - part[i-1][1]);
      if (length) { pieces.push([part[i-1], part[i], total, length]); total += length; }
    }
    if (!total) return {tracks: 0};
    const count = Math.min(MAX_PROBES, Math.max(1, Math.round(total / step)));
    const probes = [];
    for (let k = 0, j = 0; k < count; k++) {
      const at = total * (k + 0.5) / count;
      while (j < pieces.length - 1 && at > pieces[j][2] + pieces[j][3]) j++;
      const [[ax, ay], [bx, by], start, length] = pieces[j];
      const f = (at - start) / length, x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
      const dx = (bx - ax) / length, dy = (by - ay) / length;
      probes.push({x, y, at, ...measure(index, line.group, x, y, dx, dy), strict: lengths[index] < short ? measure(index, line.group, x, y, dx, dy, true).count : undefined});
    }
    // A short way (a crossover, or a track piece between switches) is a
    // connector, and not counted, when the tracks beside it run at an angle
    // to it: at most probes, fewer neighbours are within SHORT_ANGLE than
    // within MAX_ANGLE. Short ways running parallel count like any other.
    if (lengths[index] < short && probes.filter(p => p.count > p.strict).length * 2 > probes.length) return {tracks: 0};
    // Smooth single-probe dips and spikes (a gap in a parallel track at a
    // bridge joint, a switch).
    const smooth = probes.map((p, k) => {
      const window = [probes[k-1], p, probes[k+1]].filter(Boolean).map(q => q.count).sort((a, b) => a - b);
      return window[Math.floor(window.length / 2)];
    });
    // Label points: stretches where this is the middle track and the count holds.
    {
      for (let k = 0; k < probes.length;) {
        if (!probes[k].central) { k++; continue; }
        let end = k;
        while (end + 1 < probes.length && probes[end + 1].central && smooth[end + 1] === smooth[k]) end++;
        const from = probes[k].at, to = probes[end].at, labels = Math.max(1, Math.floor((to - from) * metres / LABEL_EVERY));
        if (end > k || probes.length === 1) for (let n = 0; n < labels; n++) {
          const target = from + (to - from) * (n + 0.5) / labels;
          const p = probes.slice(k, end + 1).reduce((a, b) => Math.abs(b.at - target) < Math.abs(a.at - target) ? b : a);
          points.push({x: p.x, y: p.y, tracks: smooth[k], group: line.group});
        }
        k = end + 1;
      }
    }
    // For the details panel: the most common count along the way.
    const tally = new Map();
    for (const c of smooth) tally.set(c, (tally.get(c) || 0) + 1);
    return {tracks: [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]};
  });
  return {lines: result, points};
}

// Railway tile features to countTracks input: present, non-ferry lines.
export function trackLines(features) {
  return features.map(f => {
    const p = f.properties;
    if (f.type !== 2 || (p.state || 'present') !== 'present' || p.feature === 'ferry') return null;
    return {group: `${p.feature === 'tram' ? 'tram' : 'rail'}${p.tunnel === true ? '-tunnel' : ''}`, main: !p.service,
      length: Number(p.way_length) || undefined, parts: f.loadGeometry().map(ring => ring.map(q => [q.x, q.y]))};
  });
}
