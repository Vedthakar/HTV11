// Mini "3D scan" thumbnail: a seeded point cloud of a small house, projected isometrically into an SVG.
// Placeholder for real scan renders. It is deterministic per site, so the same site always looks the same.
import type {Site} from '../mission/types.ts';

function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

interface Pt { x: number; y: number; z: number; hazard?: boolean; }

/** Points on the walls, gable roof and ground of a w×d house with eaves at h and ridge at h+r. */
function housePoints(site: Site, count: number): Pt[] {
  const rand = rng(site.id);
  const w = 1.6 + rand() * 0.8, d = 1.2 + rand() * 0.6, h = 1 + rand() * 0.5, r = 0.5 + rand() * 0.4;
  const pts: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const k = rand();
    if (k < 0.5) { // walls
      const side = Math.floor(rand() * 4), u = rand(), z = rand() * h;
      const [x, y] = side === 0 ? [u * w, 0] : side === 1 ? [w, u * d] : side === 2 ? [u * w, d] : [0, u * d];
      pts.push({x, y, z});
    } else if (k < 0.62) { // gable ends
      const u = rand(), v = rand() * (1 - Math.abs(2 * u - 1));
      pts.push({x: rand() < 0.5 ? 0 : w, y: u * d, z: h + v * r});
    } else if (k < 0.9) { // roof planes
      const y = rand() * d;
      pts.push({x: rand() * w, y, z: h + r * (1 - Math.abs(y - d / 2) / (d / 2))});
    } else { // ground ring
      const a = rand() * Math.PI * 2, rad = 0.4 + rand() * 0.5;
      pts.push({x: w / 2 + Math.cos(a) * (w / 2 + rad), y: d / 2 + Math.sin(a) * (d / 2 + rad), z: 0});
    }
  }
  // Hazard clusters: a few points near a random wall spot per hazard.
  for (let n = 0; n < site.hazards.length; n++) {
    const cx = rand() * w, cz = rand() * h;
    for (let i = 0; i < 7; i++) pts.push({x: cx + (rand() - 0.5) * 0.3, y: 0, z: cz + (rand() - 0.5) * 0.3, hazard: true});
  }
  return pts;
}

/**
 * SVG markup for the thumbnail. A failed scan drops a wedge of points to read as "incomplete".
 * Each point carries --d (ms) so CSS can make the scan "resolve" point by point.
 */
export function scanThumbnailSvg(site: Site, {width = 64, height = 44, count = 150} = {}): string {
  const rand = rng(site.id + ':order');
  let pts = housePoints(site, count);
  if (site.status === 'failed') pts = pts.filter(p => p.x + p.z * 0.6 < 1.6); // occluded half never captured
  const a = Math.PI / 6, cos = Math.cos(a), sin = Math.sin(a);
  const proj = pts.map(p => ({sx: (p.x - p.y) * cos, sy: (p.x + p.y) * sin - p.z * 1.15, depth: p.x + p.y, p}));
  const xs = proj.map(q => q.sx), ys = proj.map(q => q.sy);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((width - 6) / (maxX - minX), (height - 6) / (maxY - minY));
  const ox = (width - (maxX - minX) * scale) / 2, oy = (height - (maxY - minY) * scale) / 2;
  const circles = proj.sort((q1, q2) => q1.depth - q2.depth).map(q => {
    const x = (ox + (q.sx - minX) * scale).toFixed(1), y = (oy + (q.sy - minY) * scale).toFixed(1);
    const cls = q.p.hazard ? ' class="hz"' : '';
    const op = (0.45 + 0.5 * (q.p.z / 2.2)).toFixed(2);
    return `<circle cx="${x}" cy="${y}" r="${q.p.hazard ? 1.1 : 0.75}" opacity="${op}" style="--d:${Math.round(rand() * 700)}ms"${cls}/>`;
  }).join('');
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">${circles}</svg>`;
}
