// Number of running tracks side by side, counted from the mapped geometry:
// OpenStreetMap maps each track as its own way, and the railway tiles carry
// no track-count tag.
// - Only running tracks count: sidings, yards, spurs and other service
//   tracks (tagged service=*) are left out.
// - Along each running track a probe is cast at right angles every STEP
//   metres. Tracks it crosses count only if they keep their distance from
//   one probe to the next (they run alongside, within SLOPE): crossovers,
//   switchover tracks and turnouts, which cut across from one track to
//   another, do not.
// - Those tracks form a bundle while each lies within MAX_GAP of the next,
//   or within LINE_GAP when both belong to the same named line: the two
//   tracks of a metro line in twin tunnels can be well apart. Tracks in
//   tunnels count with those on the surface or on viaducts beside them (a
//   line quadrupled with one pair underground, or stacked above the other),
//   with the tunnel gaps only between two tunnel tracks; trams are only
//   compared with trams (group). A bundle entirely in tunnels is marked so.
// - The count is taken where it is measured, not for a whole way. Along
//   each track it is the most common count over WINDOW probes around each
//   point, so a brief extra (a crossover) or a brief gap (a track bending
//   away for a few metres) does not change it. Where the track is its
//   bundle's middle one (one per bundle, the same for every member),
//   stretches of equal count give label points, at the middle of the
//   stretch and every LABEL_EVERY metres along it.
// Metres between neighbouring tracks: of different or unnamed lines (on the
// surface a corridor's track pairs are often 15–26 m apart, such as south
// of Ōmiya; separate tunnels are separate structures), and of the same line
// (twin-bore tunnels, island platforms). Tunnel values apply between two
// tunnel tracks, surface values otherwise.
const MAX_GAP = {surface: 30, tunnel: 12};
const LINE_GAP = {surface: 30, tunnel: 35};
const PROBE = 120;           // metres each side of the track
const STEP = 40;             // metres between probes
const MAX_PROBES = 400;
const MAX_ANGLE = Math.sin(15 * Math.PI / 180); // first sieve: roughly parallel at the probe
const SLOPE = Math.tan(2.5 * Math.PI / 180);    // alongside: change of distance per metre along
const SAME_PLACE = 1;        // metres: another track this close to where one was is taken as its continuation
const SLACK = 0.6;           // tile units of that allowed for coordinate rounding
const SINGLE_ANGLE = Math.sin(2.5 * Math.PI / 180); // for a way too short for two probes
const WINDOW = 7;            // probes (about 280 m) over which the count is taken
const SHORT = 150;           // metres: shorter ways may be connectors
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

// The most common value; between equally common ones, the one nearest the
// middle value.
function mode(values) {
  const tally = new Map();
  for (const v of values) tally.set(v, (tally.get(v) || 0) + 1);
  const sorted = [...values].sort((a, b) => a - b), middle = sorted[Math.floor(sorted.length / 2)];
  return [...tally].sort((a, b) => b[1] - a[1] || Math.abs(a[0] - middle) - Math.abs(b[0] - middle) || a[0] - b[0])[0][0];
}

// lines: [{group, main, line?, length?, parts:[[[x,y],...], ...]}] in tile
// units; main is false for sidings, yards and other service tracks; line
// names the railway line (tracks with the same name may be further apart);
// length is the whole way's length in metres, if known. Returns
// {lines, points}: per line {tracks} (the most common count along it, 0
// when not measured, as for service tracks and connectors), and label
// points [{x, y, tracks, group}] in tile units. Options: probe(i), whether
// to measure line i (the others are only neighbours; default all); debug,
// an object that receives each measured line's probes (for tuning).
export function countTracks(lines, metres, {probe: measured = () => true, debug} = {}) {
  const probe = PROBE / metres, step = STEP / metres, short = SHORT / metres, slack = SLACK, samePlace = SAME_PLACE / metres;
  const lengths = lines.map(line => line.length > 0 ? line.length / metres : lengthOf(line.parts));
  const segments = [], cell = probe, grid = new Map();
  lines.forEach((line, index) => {
    if (line.main === false) return;
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
  // Tracks a probe at p on `index`, heading d, crosses: line index → offset
  // along the probe (the nearest crossing of each line), and line index →
  // sine of the angle between them there.
  const cross = (index, group, px, py, dx, dy) => {
    const nx = -dy, ny = dx, offsets = new Map([[index, 0]]), sines = new Map([[index, 0]]), seen = new Set();
    const x0 = px - nx * probe, x1 = px + nx * probe, y0 = py - ny * probe, y1 = py + ny * probe;
    for (let gx = Math.floor(Math.min(x0, x1) / cell); gx <= Math.floor(Math.max(x0, x1) / cell); gx++)
      for (let gy = Math.floor(Math.min(y0, y1) / cell); gy <= Math.floor(Math.max(y0, y1) / cell); gy++) {
        for (const s of grid.get(gx * 65536 + gy) || []) {
          if (s.index === index || s.group !== group || seen.has(s)) continue;
          seen.add(s);
          const sine = Math.abs(s.dx * dy - s.dy * dx);
          if (sine > MAX_ANGLE) continue;
          // Probe P + t·n meets segment A + u·(B − A).
          const ex = s.x2 - s.x1, ey = s.y2 - s.y1, det = ex * ny - ey * nx;
          if (!det) continue;
          const qx = s.x1 - px, qy = s.y1 - py;
          const t = (ex * qy - ey * qx) / det, u = (nx * qy - ny * qx) / det;
          if (u < 0 || u > 1 || Math.abs(t) > probe) continue;
          if (!offsets.has(s.index) || Math.abs(t) < Math.abs(offsets.get(s.index))) { offsets.set(s.index, t); sines.set(s.index, sine); }
        }
      }
    return {offsets, sines};
  };
  const sameLine = (a, b) => Boolean(lines[a].line) && lines[a].line === lines[b].line;
  // The bundle around `index` among the offsets, its size and whether
  // `index` is its middle track.
  const bundle = (index, group, offsets) => {
    const sorted = [...offsets].sort((a, b) => a[1] - b[1]);
    const joined = (a, b) => {
      const kind = lines[a[0]].tunnel && lines[b[0]].tunnel ? 'tunnel' : 'surface';
      return b[1] - a[1] <= MAX_GAP[kind] / metres || (b[1] - a[1] <= LINE_GAP[kind] / metres && sameLine(a[0], b[0]));
    };
    let lo = sorted.findIndex(([i]) => i === index), hi = lo;
    while (lo > 0 && joined(sorted[lo-1], sorted[lo])) lo--;
    while (hi < sorted.length - 1 && joined(sorted[hi], sorted[hi+1])) hi++;
    // Ways meeting end to end cross the probe at the same place: one track.
    // Tracks of two different named lines there cross each other (one
    // passes over the other) and both count.
    const one = (a, b) => b[1] - a[1] <= 0.8 / metres && (!lines[a[0]].line || !lines[b[0]].line || sameLine(a[0], b[0]));
    const members = sorted.slice(lo, hi + 1).filter((entry, i, all) => !i || !one(all[i-1], entry));
    // The middle track: nearest the bundle's centre; between two equally
    // near, the lower index, so every member picks the same one whichever
    // way it was drawn.
    const middle = (members[0][1] + members.at(-1)[1]) / 2, tie = 0.5 / metres;
    let best = members[0];
    for (const entry of members.slice(1)) {
      const d = Math.abs(entry[1] - middle), b = Math.abs(best[1] - middle);
      if (d < b - tie || (Math.abs(d - b) <= tie && entry[0] < best[0])) best = entry;
    }
    return {count: members.length, central: best[0] === index, tunnel: members.every(([i]) => lines[i].tunnel)};
  };
  const points = [];
  const result = lines.map((line, index) => {
    if (line.main === false || !measured(index)) return {tracks: 0};
    const pieces = [];
    let total = 0;
    for (const part of line.parts) for (let i = 1; i < part.length; i++) {
      const length = Math.hypot(part[i][0] - part[i-1][0], part[i][1] - part[i-1][1]);
      if (length) { pieces.push([part[i-1], part[i], total, length]); total += length; }
    }
    if (!total) return {tracks: 0};
    const count = Math.min(MAX_PROBES, Math.max(1, Math.round(total / step)));
    const spacing = total / count, probes = [];
    for (let k = 0, j = 0; k < count; k++) {
      const at = total * (k + 0.5) / count;
      while (j < pieces.length - 1 && at > pieces[j][2] + pieces[j][3]) j++;
      const [[ax, ay], [bx, by], start, length] = pieces[j];
      const f = (at - start) / length, x = ax + (bx - ax) * f, y = ay + (by - ay) * f;
      const {offsets, sines} = cross(index, line.group, x, y, (bx - ax) / length, (by - ay) / length);
      probes.push({x, y, at, crossed: offsets, sines});
    }
    // Keep the tracks that run alongside: at nearly the same distance two
    // probes (about 80 m) away, or at the next probe if also nearly parallel
    // here (over 40 m, rounding hides a gentle crossover). A short way keeps
    // only tracks nearly parallel to it.
    const isShort = lengths[index] < short;
    for (const [k, p] of probes.entries()) {
      // The same way further along, or (tracks are often split into many
      // short ways) any track at the same distance there.
      const steady = (i, t, q, apart) => q && ((q.crossed.has(i) && Math.abs(q.crossed.get(i) - t) <= SLOPE * spacing * apart + slack) ||
        [...q.crossed].some(([j, u]) => j !== index && Math.abs(u - t) <= samePlace + slack));
      p.alongside = new Map([...p.crossed].filter(([i, t]) => i === index || (
        (!isShort || p.sines.get(i) <= SINGLE_ANGLE) && (probes.length === 1 ||
          steady(i, t, probes[k-2], 2) || steady(i, t, probes[k+2], 2) ||
          (p.sines.get(i) <= SINGLE_ANGLE && (steady(i, t, probes[k-1], 1) || steady(i, t, probes[k+1], 1)))))));
      Object.assign(p, bundle(index, line.group, p.alongside));
      p.near = bundle(index, line.group, p.crossed).count;
    }
    // A short way whose neighbours mostly cut across it (it links two
    // tracks: a crossover) is not a track of its own here.
    if (isShort && probes.filter(p => p.near > p.count).length * 2 > probes.length) return {tracks: 0};
    if (debug) debug[index] = probes;
    const half = Math.floor(WINDOW / 2);
    const smooth = probes.map((p, k) => mode(probes.slice(Math.max(0, k - half), k + half + 1).map(q => q.count)));
    if (debug) probes.forEach((p, k) => { p.smooth = smooth[k]; });
    // Label points: stretches where this is the middle track and the count holds.
    for (let k = 0; k < probes.length;) {
      if (!probes[k].central) { k++; continue; }
      let end = k;
      while (end + 1 < probes.length && probes[end + 1].central && smooth[end + 1] === smooth[k]) end++;
      const from = probes[k].at, to = probes[end].at, labels = Math.max(1, Math.floor((to - from) * metres / LABEL_EVERY));
      if (end > k || probes.length === 1) for (let n = 0; n < labels; n++) {
        const target = from + (to - from) * (n + 0.5) / labels;
        const p = probes.slice(k, end + 1).reduce((a, b) => Math.abs(b.at - target) < Math.abs(a.at - target) ? b : a);
        points.push({x: p.x, y: p.y, tracks: smooth[k], group: line.group, tunnel: p.tunnel});
      }
      k = end + 1;
    }
    // For the details panel: the most common count along the way.
    return {tracks: mode(smooth)};
  });
  return {lines: result, points};
}

// Tracks at a station, a different measure from the running tracks
// outside: across the station's area (the provider's grouped station area),
// every track counts, running or not, as platform and passing tracks are
// often mapped as sidings; yards, spurs and crossovers do not. The number is
// the most tracks one cross-section meets, at right angles to a running
// track inside the area every STATION_STEP metres, smoothed over three such
// sections so a single odd one (a turnout) does not set it, on every level
// (underground platforms included). zones: [{inside(x, y)}]. Returns per zone {x, y, tracks} at
// the middle of the widest cross-section, or null.
const STATION_STEP = 20;
const NOT_AT_STATION = new Set(['yard', 'spur', 'crossover']);
export function stationTracks(lines, zones, metres) {
  const probe = PROBE / metres, step = STATION_STEP / metres, cell = probe, samePlace = 0.8 / metres, grid = new Map();
  lines.forEach((line, index) => {
    if (NOT_AT_STATION.has(line.service)) return;
    for (const part of line.parts) for (let i = 1; i < part.length; i++) {
      const [x1, y1] = part[i-1], [x2, y2] = part[i], length = Math.hypot(x2 - x1, y2 - y1);
      if (!length) continue;
      const s = {index, group: line.group, x1, y1, x2, y2, dx: (x2 - x1) / length, dy: (y2 - y1) / length};
      for (let gx = Math.floor(Math.min(x1, x2) / cell); gx <= Math.floor(Math.max(x1, x2) / cell); gx++)
        for (let gy = Math.floor(Math.min(y1, y2) / cell); gy <= Math.floor(Math.max(y1, y2) / cell); gy++) {
          const key = gx * 65536 + gy;
          if (!grid.has(key)) grid.set(key, []);
          grid.get(key).push(s);
        }
    }
  });
  // The tracks a cross-section at p (heading d) meets inside the zone, as
  // sorted offsets, ways meeting end to end taken as one track.
  const section = (zone, group, px, py, dx, dy) => {
    const nx = -dy, ny = dx, nearest = new Map(), seen = new Set();
    const x0 = px - nx * probe, x1 = px + nx * probe, y0 = py - ny * probe, y1 = py + ny * probe;
    for (let gx = Math.floor(Math.min(x0, x1) / cell); gx <= Math.floor(Math.max(x0, x1) / cell); gx++)
      for (let gy = Math.floor(Math.min(y0, y1) / cell); gy <= Math.floor(Math.max(y0, y1) / cell); gy++)
        for (const s of grid.get(gx * 65536 + gy) || []) {
          if (s.group !== group || seen.has(s) || Math.abs(s.dx * dy - s.dy * dx) > MAX_ANGLE) continue;
          seen.add(s);
          const ex = s.x2 - s.x1, ey = s.y2 - s.y1, det = ex * ny - ey * nx;
          if (!det) continue;
          const qx = s.x1 - px, qy = s.y1 - py, t = (ex * qy - ey * qx) / det, u = (nx * qy - ny * qx) / det;
          if (u < 0 || u > 1 || Math.abs(t) > probe || !zone.inside(px + nx * t, py + ny * t)) continue;
          if (!nearest.has(s.index) || Math.abs(t) < Math.abs(nearest.get(s.index))) nearest.set(s.index, t);
        }
    return [...nearest.values()].sort((a, b) => a - b).filter((t, i, all) => !i || t - all[i-1] > samePlace);
  };
  const widest = (zone, group) => {
    let best = null;
    for (const line of lines) {
      if (line.main === false || line.group !== group) continue;
      for (const part of line.parts) {
        const sections = [];
        for (let i = 1; i < part.length; i++) {
          const [ax, ay] = part[i-1], [bx, by] = part[i], length = Math.hypot(bx - ax, by - ay);
          for (let at = step / 2; at < length; at += step) {
            const px = ax + (bx - ax) * at / length, py = ay + (by - ay) * at / length;
            if (!zone.inside(px, py)) { sections.push(null); continue; }
            const dx = (bx - ax) / length, dy = (by - ay) / length, offsets = section(zone, group, px, py, dx, dy);
            const mid = (offsets[0] + offsets.at(-1)) / 2;
            sections.push({count: offsets.length, x: px - dy * mid, y: py + dx * mid});
          }
        }
        sections.forEach((s, k) => {
          if (!s) return;
          const around = sections.slice(Math.max(0, k - 1), k + 2).filter(Boolean).map(q => q.count);
          const count = around.length === 3 ? mode(around) : Math.min(...around);
          if (!best || count > best.tracks) best = {x: s.x, y: s.y, tracks: count};
        });
      }
    }
    return best;
  };
  return zones.map(zone => widest(zone, 'rail'));
}

// Railway tile features to countTracks input: present, non-ferry lines.
export function trackLines(features) {
  return features.map(f => {
    const p = f.properties;
    if (f.type !== 2 || (p.state || 'present') !== 'present' || p.feature === 'ferry') return null;
    return {group: p.feature === 'tram' ? 'tram' : 'rail', tunnel: p.tunnel === true, main: !p.service, service: p.service || undefined,
      line: p.name || p.ref || undefined, length: Number(p.way_length) || undefined,
      parts: f.loadGeometry().map(ring => ring.map(q => [q.x, q.y]))};
  });
}
