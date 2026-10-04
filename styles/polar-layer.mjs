// The polar caps on the globe: a MapLibre custom layer drawing the data
// prepared for the two circles beyond 85.05° (scripts/build-polar.mjs), in
// the style's own colours, where Web Mercator tiles stop. Geometry is given
// to MapLibre's globe shader as Web Mercator coordinates, which beyond the
// tiles' edge are simply below 0 (north) or above 1 (south); the shader
// turns them into points on the sphere like any other.
import earcut from 'earcut';
import {CAP_RADIUS, MERCATOR_LIMIT, POLAR_DETAIL_ZOOM, polarBandFor, decodeLine, fromPolar, toPolar} from './polar.mjs';

// Style colours (world.style.json): land background, water, ice shelf
// (hsl(47, 26%, 88%) at 0.8), runways, contours; and the caps under
// satellite imagery.
const COLOURS = {noImagery: '#000000', land: '#f2f1e9', water: '#bfd8e0', iceShelf: '#e8e5d8', runway: '#ffffff', contourLand: '#927b5a', contourSeabed: '#467d9a'};
const CARTO_COLOURS = {...COLOURS,land:'#f2efe9',water:'#aad3df',iceShelf:'#ddecec', building:'#d9d0c9',apron:'#e9dce5',road:'#ffffff',path:'#b29b7d',waterway:'#aad3df',taxiway:'#bbc0c4'};
const rgba = (hex, alpha = 1) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).concat(alpha);
// Opacity by zoom, as the style's contour layers: [zoom, opacity] stops.
const ramp = (stops, zoom) => {
  if (zoom <= stops[0][0]) return stops[0][1];
  for (let k = 1; k < stops.length; k++) if (zoom <= stops[k][0]) {
    const [z0, a0] = stops[k - 1], [z1, a1] = stops[k];
    return a0 + (a1 - a0) * (zoom - z0) / (z1 - z0);
  }
  return stops.at(-1)[1];
};
const MIN_ZOOM = {land: 7, seabed: 5, runway: 10, places: 8};
// The style's relief (terrain-relief, a hillshade layer).
const RELIEF = {exaggeration: 0.3, shadow: '#667365', highlight: '#ffffff', accent: '#738978', direction: 315};
const OPACITY = {land: [[7, 0.45], [12, 0.65]], seabed: [[5, 0.4], [12, 0.65]]};

// Web Mercator coordinates (0–1) of a polar point; the pole itself is kept
// a hair away, where Mercator is finite.
function mercator(cap, point) {
  const [lng, lat] = fromPolar(cap, point), φ = Math.max(-89.9999, Math.min(89.9999, lat)) * Math.PI / 180;
  return [(lng + 180) / 360, 0.5 - Math.log(Math.tan(Math.PI / 4 + φ / 2)) / (2 * Math.PI)];
}
// A disc over the cap in rings and spokes, fine enough that its triangles
// follow the sphere.
// Each corner carries its Web Mercator position and, for the relief, its
// polar one.
function discMesh(cap) {
  const rings = 24, spokes = 144, positions = [], polar = [], indices = [];
  positions.push(...mercator(cap, [0, 0])); polar.push(0, 0);
  for (let r = 1; r <= rings; r++) for (let s = 0; s < spokes; s++) {
    const radius = CAP_RADIUS * r / rings, a = s / spokes * 2 * Math.PI, p = [radius * Math.cos(a), radius * Math.sin(a)];
    positions.push(...mercator(cap, p)); polar.push(...p);
  }
  const at = (r, s) => r === 0 ? 0 : 1 + (r - 1) * spokes + (s % spokes);
  for (let r = 0; r < rings; r++) for (let s = 0; s < spokes; s++) {
    if (r === 0) indices.push(0, at(1, s), at(1, s + 1));
    else indices.push(at(r, s), at(r + 1, s), at(r + 1, s + 1), at(r, s), at(r + 1, s + 1), at(r, s + 1));
  }
  return {positions, polar, indices};
}
// Polygons (rings of polar points) as triangles, split in the polar plane.
function fillMesh(cap, polygons) {
  const positions = [], indices = [];
  for (const rings of polygons) {
    const flat = [], holes = [];
    for (const ring of rings) { if (flat.length) holes.push(flat.length / 2); for (const p of ring) flat.push(...p); }
    const base = positions.length / 2;
    for (const i of earcut(flat, holes)) indices.push(base + i);
    for (let k = 0; k < flat.length; k += 2) positions.push(...mercator(cap, [flat[k], flat[k + 1]]));
  }
  return {positions, indices};
}
// Lines as quads, widened on screen by the shader: each corner carries its
// end, the other end and a side (±1).
function lineMesh(cap, lines) {
  const data = [], indices = [];
  for (const line of lines) {
    const points = line.map(p => mercator(cap, p));
    for (let k = 1; k < points.length; k++) {
      const a = points[k - 1], b = points[k], base = data.length / 5;
      data.push(...a, ...b, 1, ...a, ...b, -1, ...b, ...a, -1, ...b, ...a, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return {data, indices};
}

const FILL_VERTEX = `in vec2 a_pos; void main() { gl_Position = projectTile(a_pos); }`;
// Lines are drawn at least a pixel wide (thinner ones fainter), with half
// a pixel more on each side over which they fade out, as MapLibre's do.
const LINE_VERTEX = `in vec2 a_pos; in vec2 a_other; in float a_side; uniform vec2 u_viewport; uniform float u_width; out float v_across;
void main() {
  vec4 p = projectTile(a_pos), q = projectTile(a_other);
  vec2 d = (q.xy / q.w - p.xy / p.w) * u_viewport;
  vec2 n = length(d) > 0.0 ? normalize(vec2(-d.y, d.x)) : vec2(0.0);
  float outset = max(u_width, 1.0) / 2.0 + 0.5;
  v_across = a_side * outset;
  gl_Position = p + vec4(n * a_side * 2.0 * outset / u_viewport * p.w, 0.0, 0.0);
}`;
const LINE_FRAGMENT = `precision highp float; uniform vec4 u_color; uniform float u_width; in float v_across; out vec4 fragColor;
void main() {
  float a = u_color.a * clamp(max(u_width, 1.0) / 2.0 + 0.5 - abs(v_across), 0.0, 1.0) * min(u_width, 1.0);
  fragColor = vec4(u_color.rgb * a, a);
}`;
// MapLibre's hillshade (hillshade_prepare and hillshade shaders) from
// the slopes prepared on the polar grid: the slope is taken to the local
// east and south, scaled as MapLibre scales its elevation tiles at the zoom
// it would use at the cap's edge (u_zoom), and shaded alike, so the relief
// carries on across 85.05°.
const RELIEF_VERTEX = `in vec2 a_pos; in vec2 a_polar; out vec2 v_polar; void main() { v_polar = a_polar; gl_Position = projectTile(a_pos); }`;
const RELIEF_FRAGMENT = `precision highp float; in vec2 v_polar; out vec4 fragColor;
uniform sampler2D u_image; uniform vec3 u_grid; uniform float u_south; uniform float u_zoom; uniform float u_edge; uniform vec2 u_light;
uniform vec4 u_shadow; uniform vec4 u_highlight; uniform vec4 u_accent; uniform float u_opacity;
#define PI 3.141592653589793
void main() {
  vec2 t = ((v_polar - u_grid.x) / u_grid.y + 0.5) / u_grid.z;
  vec2 c = texture(u_image, t).rg * 255.0 - 128.0;
  vec2 g = sign(c) * (c / 127.0) * (c / 127.0);
  float r = length(v_polar);
  vec2 away = r > 0.0 ? v_polar / r : vec2(0.0, 1.0);
  vec2 north = u_south > 0.5 ? away : -away, east = vec2(north.y, -north.x);
  vec2 slope = vec2(dot(g, east), -dot(g, north));
  float factor = u_zoom < 2.0 ? 0.4 : u_zoom < 4.5 ? 0.35 : 0.3;
  float exaggeration = u_zoom < 15.0 ? (u_zoom - 15.0) * factor : 0.0;
  vec2 deriv = clamp(slope * u_edge / (2.0 * pow(2.0, exaggeration)), -1.0, 1.0);
  float steep = atan(1.25 * length(deriv) / u_edge);
  float aspect = deriv.x != 0.0 ? atan(deriv.y, -deriv.x) : PI / 2.0 * (deriv.y > 0.0 ? 1.0 : -1.0);
  float intensity = u_light.x, azimuth = u_light.y + PI, base = 1.875 - intensity * 1.75, maxValue = 0.5 * PI;
  float scaled = intensity != 0.5 ? ((pow(base, steep) - 1.0) / (pow(base, maxValue) - 1.0)) * maxValue : steep;
  vec4 accent = (1.0 - cos(scaled)) * u_accent * clamp(intensity * 2.0, 0.0, 1.0);
  float shade = abs(mod((aspect + azimuth) / PI + 0.5, 2.0) - 1.0);
  vec4 shadeColor = mix(u_shadow, u_highlight, shade) * sin(scaled) * clamp(intensity * 2.0, 0.0, 1.0);
  fragColor = (accent * (1.0 - shadeColor.a) + shadeColor) * u_opacity;
}`;
const FRAGMENT = `precision mediump float; uniform vec4 u_color; out vec4 fragColor; void main() { fragColor = vec4(u_color.rgb * u_color.a, u_color.a); }`;

// data: where the prepared files are; units(): 'metric' or 'imperial';
// relief(): whether relief and contours are shown; places(features):
// called with the named places in view, for labels; imagery(): whether the
// background is satellite imagery, which has no picture beyond 85.05°: the
// caps are then plain black rather than a drawn map beside a photograph.
export class PolarLayer {
  constructor({data, units, maxTileBytes=32*1024*1024, maxTiles=64, relief = () => true, places = () => {}, imagery = () => false, palette = () => 'map'}) {
    Object.assign(this, {id: 'polar-caps', type: 'custom', renderingMode: '2d', data, units, relief, places, imagery, palette});
    this.maxTileBytes=maxTileBytes;this.maxTiles=maxTiles;this.visibleKeys=new Set();this.generation=0;
    this.programs = new Map(); this.caps = {north: {}, south: {}}; this.tiles = new Map();
  }
  onAdd(map, gl) { this.map = map; this.gl = gl; this.generation++;this.pending=new AbortController(); }
  onRemove() {
    this.generation++;this.pending?.abort();this.detailPending?.abort();this.detailPending=null;
    for (const tile of this.tiles.values()) this.freeMesh(tile);
    for (const cap of Object.values(this.caps)) {
      for (const mesh of Object.values(cap)) if (mesh?.buffers) this.freeMesh(mesh);
      if (cap.relief) this.gl.deleteTexture(cap.relief);
    }
    for(const {program} of this.programs.values())this.gl.deleteProgram(program);
    this.tiles.clear(); this.caps = {north: {}, south: {}}; this.programs.clear();
  }
  program(kind, shaderData) {
    const key = `${kind}:${shaderData.variantName}`;
    if (this.programs.has(key)) return this.programs.get(key);
    const gl = this.gl, compile = (type, source) => {
      const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(shader);gl.deleteShader(shader);throw new Error(error);}
      return shader;
    };
    const program = gl.createProgram(), vertex = {line: LINE_VERTEX, fill: FILL_VERTEX, relief: RELIEF_VERTEX}[kind];
    let vertexShader,fragmentShader;
    try {
      vertexShader=compile(gl.VERTEX_SHADER, `#version 300 es\n${shaderData.vertexShaderPrelude}\n${shaderData.define}\n${vertex}`);
      fragmentShader=compile(gl.FRAGMENT_SHADER, `#version 300 es\n${{line: LINE_FRAGMENT, relief: RELIEF_FRAGMENT}[kind] || FRAGMENT}`);
      gl.attachShader(program,vertexShader);gl.attachShader(program,fragmentShader);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));
    }catch(error){gl.deleteProgram(program);throw error;}
    finally{if(vertexShader)gl.deleteShader(vertexShader);if(fragmentShader)gl.deleteShader(fragmentShader);}
    const uniforms = {};
    for (const name of ['u_projection_matrix', 'u_projection_fallback_matrix', 'u_projection_tile_mercator_coords', 'u_projection_clipping_plane', 'u_projection_transition', 'u_color', 'u_viewport', 'u_width',
      'u_image', 'u_grid', 'u_south', 'u_zoom', 'u_edge', 'u_light', 'u_shadow', 'u_highlight', 'u_accent', 'u_opacity'])
      uniforms[name] = gl.getUniformLocation(program, name);
    const entry = {program, uniforms, attributes: Object.fromEntries(['pos', 'other', 'side', 'polar'].map(a => [a, gl.getAttribLocation(program, `a_${a}`)]))};
    this.programs.set(key, entry);
    return entry;
  }
  upload(mesh, kind) {
    const gl = this.gl, vertices = gl.createBuffer(), indices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    const data = kind === 'line' ? mesh.data : kind === 'relief' ? mesh.positions.flatMap((v, i) => i % 2 ? [v, mesh.polar[i - 1], mesh.polar[i]] : [v]) : mesh.positions;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.indices), gl.STATIC_DRAW);
    return {kind,bytes:(data.length+mesh.indices.length)*4, buffers: [vertices, indices], count: mesh.indices.length};
  }
  freeMesh(mesh) { for (const b of mesh.buffers || []) this.gl.deleteBuffer(b); for (const m of mesh.parts || []) this.freeMesh(m); }
  // Draw a mesh; set(gl, uniforms) sets the uniforms of its kind.
  draw(mesh, shaderData, projection, set) {
    if (!mesh?.count) return;
    const gl = this.gl, {program, uniforms, attributes} = this.program(mesh.kind, shaderData);
    gl.useProgram(program);
    set(gl, uniforms);
    gl.uniformMatrix4fv(uniforms.u_projection_matrix, false, projection.mainMatrix);
    gl.uniformMatrix4fv(uniforms.u_projection_fallback_matrix, false, projection.fallbackMatrix);
    gl.uniform4f(uniforms.u_projection_tile_mercator_coords, ...projection.tileMercatorCoords);
    gl.uniform4f(uniforms.u_projection_clipping_plane, ...projection.clippingPlane);
    gl.uniform1f(uniforms.u_projection_transition, projection.projectionTransition);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffers[0]);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.buffers[1]);
    if (mesh.kind === 'line') {
      gl.enableVertexAttribArray(attributes.pos); gl.vertexAttribPointer(attributes.pos, 2, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(attributes.other); gl.vertexAttribPointer(attributes.other, 2, gl.FLOAT, false, 20, 8);
      gl.enableVertexAttribArray(attributes.side); gl.vertexAttribPointer(attributes.side, 1, gl.FLOAT, false, 20, 16);
    } else if (mesh.kind === 'relief') {
      gl.enableVertexAttribArray(attributes.pos); gl.vertexAttribPointer(attributes.pos, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(attributes.polar); gl.vertexAttribPointer(attributes.polar, 2, gl.FLOAT, false, 16, 8);
    } else {
      gl.enableVertexAttribArray(attributes.pos); gl.vertexAttribPointer(attributes.pos, 2, gl.FLOAT, false, 8, 0);
    }
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_INT, 0);
    for (const a of Object.values(attributes)) if (a >= 0) gl.disableVertexAttribArray(a);
  }
  fill(mesh, shaderData, projection, color) { this.draw(mesh, shaderData, projection, (gl, u) => gl.uniform4f(u.u_color, ...color)); }
  line(mesh, shaderData, projection, color, width) {
    this.draw(mesh, shaderData, projection, (gl, u) => {
      gl.uniform4f(u.u_color, ...color);
      gl.uniform2f(u.u_viewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(u.u_width, width * this.map.getPixelRatio());
    });
  }
  async image(name) {
    const generation=this.generation;
    const response = await fetch(new URL(name, this.data),{signal:this.pending?.signal});
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    const bitmap = await createImageBitmap(await response.blob(), {premultiplyAlpha: 'none', colorSpaceConversion: 'none'});
    if(generation!==this.generation){bitmap.close?.();return null;}
    const gl = this.gl, texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    bitmap.close?.();
    return texture;
  }
  async json(name, signal = this.pending?.signal) {
    const response = await fetch(new URL(name, this.data),{signal});
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.json();
  }
  // Load once per cap: the disc, its index of contour tiles and its features.
  loadCap(cap) {
    const state = this.caps[cap],generation=this.generation;
    if (state.loading) return;
    state.loading = true;
    const disc = discMesh(cap);
    state.disc = this.upload(disc, 'fill'); state.reliefMesh = this.upload(disc, 'relief');
    this.image(`${cap}-relief.png`).then(texture => { if(!texture)return;if(generation!==this.generation){this.gl.deleteTexture(texture);return;}state.relief = texture; this.map.triggerRepaint(); }).catch(() => {});
    Promise.all([this.json(`${cap}-index.json`), this.json(`${cap}-features.json`).catch(() => null)]).then(([index, features]) => {
      if(generation!==this.generation)return;
      state.index = index;
      if (features) {
        const areas = list => this.upload(fillMesh(cap, (list || []).map(rings => rings.map(r => decodeLine(r)))), 'fill');
        state.water = areas(features.water); state.iceShelves = areas(features.iceShelves);
        state.runways = this.upload(lineMesh(cap, features.runways.map(r => decodeLine(r))), 'line');
        state.places = features.places.map(p => ({...p, lngLat: fromPolar(cap, [p.x, p.y])}));
      }
      this.map.triggerRepaint();
    }).catch(error => { console.warn('Polar map data unavailable:', error.message); });
  }
  // Contour tile: four meshes (land/seabed, fine/emphasised).
  loadTile(key) {
    if (this.tiles.has(key)){const tile=this.tiles.get(key);this.tiles.delete(key);this.tiles.set(key,tile);return tile;}
    const detailed = Number(key.split('-')[2]) > 0;
    const tile = {loading: true, detailed},generation=this.generation;
    this.tiles.set(key, tile);
    const cap = key.split('-')[0];
    this.json(`${key}.json`, detailed ? this.detailPending?.signal : this.pending?.signal).then(({lines}) => {
      if(generation!==this.generation||this.tiles.get(key)!==tile)return;
      const groups = {landMinor: [], landMajor: [], seabedMinor: [], seabedMajor: []};
      for (const [level, major, ...values] of lines) groups[`${level > 0 ? 'land' : 'seabed'}${major ? 'Major' : 'Minor'}`].push(decodeLine(values));
      Object.assign(tile, Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, this.upload(lineMesh(cap, v), 'line')])));
      tile.parts = Object.keys(groups).map(k => tile[k]); tile.loading = false;tile.bytes=tile.parts.reduce((sum,m)=>sum+m.bytes,0);
      this.pruneTiles();
      this.map.triggerRepaint();
    }).catch(() => { tile.failed = true; });
    return tile;
  }
  // Detailed meshes and in-flight requests exist only in a visible Carto
  // cap. Switching backgrounds removes them immediately; coarse data stays.
  syncDetail(active) {
    if (active) { this.detailPending ||= new AbortController(); return; }
    this.detailPending?.abort();this.detailPending=null;
    for (const [key, tile] of this.tiles) if (tile.detailed) { this.freeMesh(tile); this.tiles.delete(key); }
  }
  loadDetailTile(key) {
    if (this.tiles.has(key)) { const tile=this.tiles.get(key);this.tiles.delete(key);this.tiles.set(key,tile);return tile; }
    const tile = {loading: true, detailed: true}, generation = this.generation, cap = key.split('-')[0];
    this.tiles.set(key, tile);
    this.json(`${key}.json`, this.detailPending?.signal).then(data => {
      if (generation !== this.generation || this.tiles.get(key) !== tile) return;
      const decode = line => decodeLine(line, 0, line.length, data.quantum || 0.001);
      for (const kind of ['buildings', 'aprons']) tile[kind] = this.upload(fillMesh(cap, (data[kind] || []).map(rings => rings.map(decode))), 'fill');
      for (const kind of ['roads', 'paths', 'waterways', 'taxiways']) tile[kind] = this.upload(lineMesh(cap, (data[kind] || []).map(decode)), 'line');
      tile.places = (data.places || []).map(p => ({...p, lngLat: fromPolar(cap, [p.x, p.y])}));
      tile.parts = ['buildings', 'aprons', 'roads', 'paths', 'waterways', 'taxiways'].map(k => tile[k]);
      tile.loading = false; tile.bytes = tile.parts.reduce((sum, m) => sum + m.bytes, 0) + tile.places.length * 256;
      this.pruneTiles(); this.map.triggerRepaint();
    }).catch(() => { tile.failed = true; });
    return tile;
  }
  // Keep the visible working set; old views have a byte and count budget.
  pruneTiles(active=this.visibleKeys) {
    let bytes=[...this.tiles.values()].reduce((sum,t)=>sum+(t.bytes||0),0);
    for(const [key,tile] of this.tiles) {
      if(bytes<=this.maxTileBytes&&this.tiles.size<=this.maxTiles)break;
      if(active.has(key))continue;
      this.freeMesh(tile);this.tiles.delete(key);bytes-=tile.bytes||0;
    }
  }
  // Which caps and contour tiles the view shows: screen points sampled,
  // those on the globe within a cap taken into its polar plane.
  visible() {
    const {clientWidth: w, clientHeight: h} = this.map.getContainer(), seen = {north: null, south: null};
    const hidden = lngLat => this.map.transform?.isLocationOccluded?.(lngLat) === true;
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
      const {lng, lat} = this.map.unproject([w * i / 12, h * j / 12]);
      if (!Number.isFinite(lat) || Math.abs(lat) < MERCATOR_LIMIT - 3) continue;
      const cap = lat > 0 ? 'north' : 'south', [x, y] = toPolar(cap, [lng, lat]);
      const box = seen[cap] ||= [Infinity, Infinity, -Infinity, -Infinity];
      box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
    }
    // Sampling can miss a cap wholly between samples when zoomed out: then
    // take the pole's own position.
    for (const cap of ['north', 'south']) {
      if (seen[cap] || hidden({lng: 0, lat: cap === 'north' ? 89.9 : -89.9})) continue;
      const p = this.map.project([0, cap === 'north' ? 89.9 : -89.9]);
      if (p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h) seen[cap] = [-CAP_RADIUS, -CAP_RADIUS, CAP_RADIUS, CAP_RADIUS];
    }
    return seen;
  }
  // zoom: by the planet's size. MapLibre draws relief from elevation tiles
  // of 256 pixels, one zoom finer than the view; at the cap's edge, where a
  // Web Mercator tile covers cos 85.05° of its width on the ground, it
  // takes tiles about that much coarser.
  drawRelief(cap, state, shaderData, projection, zoom, fade) {
    const {x0, step, size} = state.index.relief, edge = Math.cos(MERCATOR_LIMIT * Math.PI / 180);
    const tileZoom = Math.max(0, Math.min(15, Math.round(zoom + 1 + Math.log2(edge))));
    const colour = hex => rgba(hex);
    this.draw(state.reliefMesh, shaderData, projection, (gl, u) => {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, state.relief); gl.uniform1i(u.u_image, 0);
      gl.uniform3f(u.u_grid, x0, step, size); gl.uniform1f(u.u_south, cap === 'south' ? 1 : 0);
      gl.uniform1f(u.u_zoom, tileZoom); gl.uniform1f(u.u_edge, edge);
      gl.uniform2f(u.u_light, RELIEF.exaggeration, RELIEF.direction * Math.PI / 180);
      gl.uniform4f(u.u_shadow, ...colour(RELIEF.shadow)); gl.uniform4f(u.u_highlight, ...colour(RELIEF.highlight)); gl.uniform4f(u.u_accent, ...colour(RELIEF.accent));
      gl.uniform1f(u.u_opacity, fade);
    });
  }
  // A failure here (a shader the device cannot build) leaves the rest of
  // the map drawn: the caps are then given up, with one warning.
  render(gl, options) {
    if (this.broken) return;
    try { this.renderCaps(gl, options); }
    catch (error) { this.broken = true; this.places([]); console.warn('Polar caps not drawn:', error?.message || error); }
  }
  renderCaps(gl, options) {
    const projection = options.defaultProjectionData, transition = projection.projectionTransition ?? 0;
    // Only on the globe: on the flat map there is nothing beyond 85.05°.
    if (!(transition > 0.01) || this.map.getProjection?.()?.type !== 'globe') { this.syncDetail(false);this.visibleKeys=new Set();this.pruneTiles();this.places([]); return; }
    const center = this.map.getCenter();
    // Zoom by the planet's size (MapLibre's zoom depends on the latitude).
    const zoom = this.map.getZoom() - Math.log2(Math.cos(Math.max(-89.9, Math.min(89.9, center.lat)) * Math.PI / 180));
    const fade = transition ** 4, units = this.units(), labels = [];
    // Line quads come in either winding, so nothing is culled.
    gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.visibleKeys=new Set();
    const view = this.visible(), imagery = this.imagery(), background = this.palette(), carto = background === 'carto', colours = carto ? CARTO_COLOURS : COLOURS;
    this.syncDetail(carto && !imagery && Boolean(view.north || view.south));
    for (const cap of ['north', 'south']) {
      if (!view[cap]) continue;
      this.loadCap(cap);
      const state = this.caps[cap];
      if (imagery) { this.fill(state.disc, options.shaderData, projection, rgba(colours.noImagery, fade)); continue; }
      this.fill(state.disc, options.shaderData, projection, rgba(cap === 'north' ? colours.water : colours.land, fade));
      this.fill(state.water, options.shaderData, projection, rgba(colours.water, fade));
      this.fill(state.iceShelves, options.shaderData, projection, rgba(colours.iceShelf, 0.8 * fade));
      const terrain = this.relief();
      if (terrain && state.relief && state.index?.relief) this.drawRelief(cap, state, options.shaderData, projection, zoom, fade);
      // The finest band prepared for this zoom (only the coarsest may exist).
      const bands = state.index?.units?.[units] || [], bandIndex = polarBandFor(zoom, background, bands.length), band = bands[bandIndex];
      if (band && terrain) {
        const size = 2 * CAP_RADIUS / band.n, [x0, y0, x1, y1] = view[cap];
        for (const key of band.tiles) {
          const [tx, ty] = key.split('-').map(Number), bx = -CAP_RADIUS + tx * size, by = -CAP_RADIUS + ty * size;
          if (bx > x1 || bx + size < x0 || by > y1 || by + size < y0) continue;
          const tileKey=`${cap}-${units}-${bandIndex}-${key}`;this.visibleKeys.add(tileKey);
          const tile = this.loadTile(tileKey);
          if (tile.loading || tile.failed) continue;
          for (const [part, kind, major] of [['seabedMinor', 'seabed', 0], ['seabedMajor', 'seabed', 1], ['landMinor', 'land', 0], ['landMajor', 'land', 1]]) {
            if (zoom < MIN_ZOOM[kind]) continue;
            this.line(tile[part], options.shaderData, projection, rgba(kind === 'land' ? colours.contourLand : colours.contourSeabed, ramp(OPACITY[kind], zoom) * fade), major ? 0.8 : 0.4);
          }
        }
      }
      if (zoom >= MIN_ZOOM.runway) this.line(state.runways, options.shaderData, projection, rgba(colours.runway, fade), 2);
      const detail = state.index?.carto;
      if (carto && !imagery && detail && zoom >= Math.max(POLAR_DETAIL_ZOOM, detail.from)) {
        const size = 2 * CAP_RADIUS / detail.n, [x0, y0, x1, y1] = view[cap];
        for (const key of detail.tiles) {
          const [tx, ty] = key.split('-').map(Number), x = -CAP_RADIUS + tx * size, y = -CAP_RADIUS + ty * size;
          if (x > x1 || x + size < x0 || y > y1 || y + size < y0) continue;
          const tileKey = `${cap}-carto-${key}`; this.visibleKeys.add(tileKey);
          const tile = this.loadDetailTile(tileKey);
          if (tile.loading || tile.failed) continue;
          this.fill(tile.aprons, options.shaderData, projection, rgba(colours.apron, fade));
          if (zoom >= 13) this.fill(tile.buildings, options.shaderData, projection, rgba(colours.building, fade));
          for (const [kind, colour, width] of [['waterways','waterway',1], ['roads','road',2], ['paths','path',1], ['taxiways','taxiway',2]])
            this.line(tile[kind], options.shaderData, projection, rgba(colours[colour], fade), width);
          if (zoom >= 12) labels.push(...tile.places);
        }
      }
      if (zoom >= MIN_ZOOM.places && state.places) labels.push(...state.places.filter(p => !this.map.transform?.isLocationOccluded?.({lng: p.lngLat[0], lat: p.lngLat[1]})));
    }
    this.pruneTiles();
    const {clientWidth: width, clientHeight: height} = this.map.getContainer();
    this.places(labels.filter(p => {
      if (this.map.transform?.isLocationOccluded?.({lng: p.lngLat[0], lat: p.lngLat[1]})) return false;
      const at = this.map.project(p.lngLat);
      return at.x >= -80 && at.x <= width + 80 && at.y >= -20 && at.y <= height + 20;
    }));
  }
}
