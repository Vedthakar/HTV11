// Pure track maths: interpolating the rover between telemetry points, slicing the traveled path,
// and deriving what a site looks like at a given moment. No DOM or map dependencies (tested in web/tests).
import type {LngLat, Mission, Site, SiteStatus, TelemetryPoint} from './types.ts';

const R = 6371008.8;
const rad = (d: number) => d * Math.PI / 180;

export function distanceM(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Initial bearing from a to b in degrees clockwise from north, 0–360. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function lineLengthM(coords: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += distanceM(coords[i - 1], coords[i]);
  return total;
}

/** Interpolates heading along the shorter arc. */
export function lerpHeading(a: number, b: number, f: number): number {
  const delta = ((b - a + 540) % 360) - 180;
  return (a + delta * f + 360) % 360;
}

/** Index of the last point with t <= time (-1 before the first point). Binary search; track is time-sorted. */
export function indexAt(track: TelemetryPoint[], time: number): number {
  let lo = 0, hi = track.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= time) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

export interface RoverPose { coord: LngLat; heading: number; speed: number; batteryPct?: number; signalPct?: number; index: number; }

/** Rover pose at `time`, linearly interpolated between telemetry points and clamped to the track's ends. */
export function poseAt(track: TelemetryPoint[], time: number): RoverPose | null {
  if (!track.length) return null;
  const i = indexAt(track, time);
  if (i < 0) return {...track[0], index: 0};
  if (i >= track.length - 1) return {...track[track.length - 1], index: track.length - 1};
  const a = track[i], b = track[i + 1];
  const f = b.t === a.t ? 0 : (time - a.t) / (b.t - a.t);
  return {
    coord: [a.coord[0] + (b.coord[0] - a.coord[0]) * f, a.coord[1] + (b.coord[1] - a.coord[1]) * f],
    heading: lerpHeading(a.heading, b.heading, f),
    speed: a.speed + (b.speed - a.speed) * f,
    batteryPct: a.batteryPct,
    signalPct: a.signalPct,
    index: i,
  };
}

/** Coordinates the rover has covered by `time`, ending exactly at its interpolated position. */
export function traveledCoords(track: TelemetryPoint[], time: number): LngLat[] {
  const pose = poseAt(track, time);
  if (!pose || time < track[0].t) return [];
  const out: LngLat[] = [];
  for (let i = 0; i <= pose.index; i++) {
    const c = track[i].coord, last = out[out.length - 1];
    if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push(c); // skip stationary dwell points
  }
  out.push(pose.coord);
  return out;
}

/** Whether the rover has reached the site by `time` (its flag is shown in replay). */
export function isSiteReached(site: Site, time: number): boolean {
  return site.arrivedAt != null && time >= site.arrivedAt;
}

/** What a site's flag shows at `time`: pending before arrival, inspecting while on site, then its final status. */
export function siteStatusAt(site: Site, time: number): SiteStatus {
  if (!isSiteReached(site, time)) return 'pending';
  if (site.departedAt == null || time < site.departedAt) return 'inspecting';
  return site.status === 'pending' || site.status === 'inspecting' ? 'inspecting' : site.status;
}

export function missionEnd(mission: Mission): number {
  return mission.endedAt ?? mission.plannedEndAt ?? mission.track[mission.track.length - 1]?.t ?? mission.startedAt;
}

export function missionDistanceM(mission: Mission): number {
  return mission.plannedRoute ? lineLengthM(mission.plannedRoute) : lineLengthM(mission.track.map(p => p.coord));
}

// Cumulative distance per track index, cached per track array and extended as a live track grows.
const cumCache = new WeakMap<TelemetryPoint[], number[]>();
function cumulative(track: TelemetryPoint[]): number[] {
  let cum = cumCache.get(track);
  if (!cum) { cum = [0]; cumCache.set(track, cum); }
  for (let i = cum.length; i < track.length; i++) cum.push(cum[i - 1] + distanceM(track[i - 1].coord, track[i].coord));
  return cum;
}

/** Metres driven by `time`, including the partial segment the rover is on. */
export function distanceAlongM(track: TelemetryPoint[], time: number): number {
  const pose = poseAt(track, time);
  if (!pose || time < track[0].t) return 0;
  return cumulative(track)[pose.index] + distanceM(track[pose.index].coord, pose.coord);
}
