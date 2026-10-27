// First-party polar depth raster: two bytes of unsigned depth (metres),
// followed by an explicit water/validity byte. Built from the cached ETOPO
// surface grid, NOT from contours or a fabricated ocean gradient.
import {crc32, deflateSync} from 'node:zlib';
import {DEPTH_COLOURS} from '../styles/bathymetry.mjs';

export const POLAR_DEPTH_FORMAT = 'rg8-metres-water-mask-v1';
export const POLAR_DEPTH_MAX_SIDE = 2048;
export const POLAR_DEPTH_MAX = DEPTH_COLOURS.at(-1)[0];

export function encodePolarDepth(grid) {
  const {cols, rows, values} = grid;
  if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows) || cols < 2 || rows < 2 ||
      cols > POLAR_DEPTH_MAX_SIDE || rows > POLAR_DEPTH_MAX_SIDE ||
      !values || values.length !== cols * rows) throw new Error('Invalid bounded polar depth grid');
  const out = new Uint8Array(cols * rows * 3);
  for (let i = 0; i < values.length; i++) {
    const elevation = values[i], at = i * 3;
    if (!Number.isFinite(elevation) || elevation > 0 || elevation < -POLAR_DEPTH_MAX) continue;
    const depth = Math.round(-elevation);
    out[at] = depth >>> 8;
    out[at + 1] = depth & 255;
    out[at + 2] = 255; // valid sea depth; empty for missing data or land
  }
  return out;
}

// Shared byte-level contract for unit tests; the WebGL shader decodes RG
// exactly this way (with nearest texel fetch, then bilinear depth sampling).
export function decodePolarDepth(bytes, at) {
  return bytes[at + 2] === 255 ? (bytes[at] << 8) + bytes[at + 1] : null;
}

// Lossless 8-bit RGB PNG, reused by polar hillshade and the new depth raster.
// No third-party encoder or extra large dataset is needed at build time.
export function png(width, height, rgb) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width > POLAR_DEPTH_MAX_SIDE || height > POLAR_DEPTH_MAX_SIDE ||
      rgb?.length !== width * height * 3) throw new Error('Invalid polar PNG dimensions');
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length), body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc(height * (1 + 3 * width));
  for (let y = 0; y < height; y++) rgb.subarray(y * 3 * width, (y + 1) * 3 * width)
    .forEach((v, i) => { raw[y * (1 + 3 * width) + 1 + i] = v; });
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, {level: 9})), chunk('IEND', Buffer.alloc(0))]);
}
