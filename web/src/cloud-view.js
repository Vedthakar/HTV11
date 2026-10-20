// Point-cloud display helpers. Distances are metres, matching the capture coordinates.

export function pointWorldSize(diagonal) {
  if (!Number.isFinite(diagonal) || diagonal <= 0) return 0.02;
  return Math.min(0.08, Math.max(0.004, diagonal * 0.0035));
}

// t = 0 is the lowest point (blue), t = 1 is the highest (amber).
export function heightRgb(t) {
  const u = Math.min(1, Math.max(0, t));
  return [0.24 + 0.71 * u, 0.43 + 0.33 * u, 0.55 - 0.24 * u];
}

// Vertex colours are linear in three.js (PLYLoader converts captured colours too), so
// convert the sRGB palette or it renders washed out.
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function heightColorBuffer(positions, count = positions.length / 3) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < count; i++) {
    const y = positions[i * 3 + 1];
    if (y < min) min = y;
    if (y > max) max = y;
  }
  const span = max - min;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const t = span > 1e-6 ? (positions[i * 3 + 1] - min) / span : 0.5;
    const [r, g, b] = heightRgb(t);
    colors[i * 3] = srgbToLinear(r);
    colors[i * 3 + 1] = srgbToLinear(g);
    colors[i * 3 + 2] = srgbToLinear(b);
  }
  return colors;
}

// Copy RGB so a later height-colour pass can restore the captured colours.
export function copyVertexColors(attribute) {
  if (!attribute || attribute.count < 1 || attribute.itemSize < 3) return null;
  const out = new Float32Array(attribute.count * 3);
  for (let i = 0; i < attribute.count; i++) {
    out[i * 3] = attribute.getX(i);
    out[i * 3 + 1] = attribute.getY(i);
    out[i * 3 + 2] = attribute.getZ(i);
  }
  return out;
}
