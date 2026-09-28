// Contour lines from a regular grid (marching squares), for the polar caps.
// grid: {values: Float32Array (row-major, NaN = no data), cols, rows,
// x0, y0, step}: cell (i, j) is at x0 + i·step, y0 + j·step.

// Segments for one level. Saddles are resolved by the cell's mean. Each
// point carries the grid edge it lies on (id), by which segments are joined:
// where the grid meets the level exactly, points of different edges fall
// on the same spot and could not be told apart by position.
export function isolineSegments(grid, level) {
  const {values, cols, rows, x0, y0, step} = grid, segments = [];
  const at = (i, j) => values[j * cols + i];
  const cross = (i1, j1, v1, i2, j2, v2) => {
    const t = (level - v1) / (v2 - v1);
    return Object.assign([x0 + (i1 + (i2 - i1) * t) * step, y0 + (j1 + (j2 - j1) * t) * step], {id: `${i1 === i2 ? 'v' : 'h'}${i1},${j1}`});
  };
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) continue;
    const code = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
    if (code === 0 || code === 15) continue;
    // Edge crossings: top (a-b), right (b-c), bottom (d-c), left (a-d).
    const top = () => cross(i, j, a, i + 1, j, b), right = () => cross(i + 1, j, b, i + 1, j + 1, c);
    const bottom = () => cross(i, j + 1, d, i + 1, j + 1, c), left = () => cross(i, j, a, i, j + 1, d);
    const mean = (a + b + c + d) / 4;
    switch (code) {
      case 1: case 14: segments.push([left(), bottom()]); break;
      case 2: case 13: segments.push([bottom(), right()]); break;
      case 3: case 12: segments.push([left(), right()]); break;
      case 4: case 11: segments.push([top(), right()]); break;
      case 6: case 9: segments.push([top(), bottom()]); break;
      case 7: case 8: segments.push([left(), top()]); break;
      case 5: if (mean >= level) { segments.push([left(), top()], [bottom(), right()]); } else { segments.push([left(), bottom()], [top(), right()]); } break;
      case 10: if (mean >= level) { segments.push([top(), right()], [left(), bottom()]); } else { segments.push([left(), top()], [bottom(), right()]); } break;
    }
  }
  return segments;
}
// Join segments sharing end points into lines.
export function joinSegments(segments) {
  const key = p => p.id ?? `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`;
  const ends = new Map(), used = new Uint8Array(segments.length);
  segments.forEach(([p, q], s) => { for (const k of [key(p), key(q)]) { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(s); } });
  const next = (point, exclude) => (ends.get(key(point)) || []).find(s => !used[s] && s !== exclude);
  const lines = [];
  for (let s = 0; s < segments.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const line = [...segments[s]];
    for (const forward of [true, false]) {
      for (;;) {
        const end = forward ? line.at(-1) : line[0], n = next(end);
        if (n === undefined) break;
        used[n] = 1;
        const [p, q] = segments[n], other = key(p) === key(end) ? q : p;
        if (forward) line.push(other); else line.unshift(other);
      }
    }
    lines.push(line);
  }
  return lines;
}
// Split lines at a circle of radius r around the origin, keeping the parts
// inside (crossing points interpolated).
export function clipToDisc(lines, r) {
  const inside = p => Math.hypot(p[0], p[1]) <= r, out = [];
  const edge = (p, q) => {
    // Point on segment p→q at distance r from the origin.
    const dx = q[0] - p[0], dy = q[1] - p[1], A = dx * dx + dy * dy, B = 2 * (p[0] * dx + p[1] * dy), C = p[0] ** 2 + p[1] ** 2 - r * r;
    const disc = Math.sqrt(Math.max(0, B * B - 4 * A * C)), roots = [(-B - disc) / (2 * A), (-B + disc) / (2 * A)].filter(t => t >= 0 && t <= 1);
    const t = roots[0] ?? 0.5;
    return [p[0] + dx * t, p[1] + dy * t];
  };
  for (const line of lines) {
    let current = inside(line[0]) ? [line[0]] : null;
    for (let k = 1; k < line.length; k++) {
      const p = line[k - 1], q = line[k], pin = inside(p), qin = inside(q);
      if (pin && qin) current.push(q);
      else if (pin && !qin) { current.push(edge(p, q)); if (current.length >= 2) out.push(current); current = null; }
      else if (!pin && qin) current = [edge(p, q), q];
    }
    if (current && current.length >= 2) out.push(current);
  }
  return out;
}
// Douglas–Peucker simplification to a tolerance (same units as points).
export function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop(), [x1, y1] = points[s], [x2, y2] = points[e];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1e-12;
    let worst = -1, index = -1;
    for (let k = s + 1; k < e; k++) {
      const d = Math.abs(dy * (points[k][0] - x1) - dx * (points[k][1] - y1)) / len;
      if (d > worst) { worst = d; index = k; }
    }
    if (worst > tolerance) { keep[index] = 1; stack.push([s, index], [index, e]); }
  }
  return points.filter((_, k) => keep[k]);
}
// Levels between min and max at an interval (never 0: the coastline is
// drawn by the map itself).
export function levels(min, max, interval) {
  const out = [];
  for (let v = Math.ceil(min / interval) * interval; v <= max; v += interval) if (v !== 0) out.push(Math.round(v * 1000) / 1000);
  return out;
}
// Split lines at a rectangle [minX, minY, maxX, maxY], keeping the parts
// inside (Liang–Barsky per segment).
export function clipToRect(lines, [minX, minY, maxX, maxY]) {
  const out = [];
  const clipSegment = ([x1, y1], [x2, y2]) => {
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;
    for (const [p, q] of [[-dx, x1 - minX], [dx, maxX - x1], [-dy, y1 - minY], [dy, maxY - y1]]) {
      if (p === 0) { if (q < 0) return null; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; }
    }
    return [[x1 + dx * t0, y1 + dy * t0], [x1 + dx * t1, y1 + dy * t1], t0 === 0, t1 === 1];
  };
  for (const line of lines) {
    let current = null;
    for (let k = 1; k < line.length; k++) {
      const clipped = clipSegment(line[k - 1], line[k]);
      if (!clipped) { if (current) { out.push(current); current = null; } continue; }
      const [a, b, startInside, endInside] = clipped;
      if (!current || !startInside) { if (current) out.push(current); current = [a]; }
      current.push(b);
      if (!endInside) { out.push(current); current = null; }
    }
    if (current && current.length >= 2) out.push(current);
  }
  return out.filter(line => line.length >= 2);
}
