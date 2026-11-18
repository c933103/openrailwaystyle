// Shared owner-name color contract for generated data and live vector tiles.
export function ownerColor(name) {
  const key = String(name ?? '').trim().toLowerCase();
  if (!key) return null;
  let hash = 0x811c9dc5;
  for (const ch of key) { hash ^= ch.codePointAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
  // Hues spread by the golden angle; saturation and lightness in three
  // steps each, kept away from the grey of "not recorded".
  const hue = Math.round((hash % 360) * 137.508) % 360, sat = [62, 74, 86][(hash >>> 9) % 3], light = [34, 42, 50][(hash >>> 13) % 3];
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}
