// Draw only decoded imagery already supplied by the shared tile-loading path.
// This module neither chooses providers nor sends requests. The caller owns
// frame order and the CSS-to-device-pixel transform.
export function drawFlatRasterLayer(context, camera, tiles, {opacity = 1} = {}) {
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
    throw new RangeError('Invalid raster layer opacity');
  if (opacity === 0) return 0;
  let drawn = 0;
  context.save();
  try {
    context.globalAlpha *= opacity;
    for (const {tile, image} of tiles) {
      if (!image) continue;
      const [a, b, c, d, x, y] = camera.tileTransform(tile);
      context.save();
      try {
        context.transform(a, b, c, d, x, y);
        context.drawImage(image, 0, 0, 1, 1);
        drawn++;
      } finally {
        context.restore();
      }
    }
  } finally {
    context.restore();
  }
  return drawn;
}
