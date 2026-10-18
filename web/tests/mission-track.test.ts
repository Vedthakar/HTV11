import test from 'node:test';
import assert from 'node:assert/strict';
import {distanceM, indexAt, lerpHeading, missionDistanceM, poseAt, siteStatusAt, traveledCoords} from '../src/mission/track.ts';
import {MOCK_MISSIONS} from '../src/mission/mock-mission.ts';
import type {Site, TelemetryPoint} from '../src/mission/types.ts';

const track: TelemetryPoint[] = [
  {t: 0, coord: [0, 0], heading: 350, speed: 1},
  {t: 1000, coord: [0.001, 0], heading: 10, speed: 1},
  {t: 2000, coord: [0.001, 0], heading: 10, speed: 0},
  {t: 3000, coord: [0.002, 0], heading: 10, speed: 1},
];

test('poseAt interpolates position and heading along the short arc, clamping at the ends', () => {
  assert.deepEqual(poseAt(track, 500)!.coord, [0.0005, 0]);
  assert.equal(Math.round(poseAt(track, 500)!.heading), 0);
  assert.deepEqual(poseAt(track, -50)!.coord, [0, 0]);
  assert.deepEqual(poseAt(track, 9999)!.coord, [0.002, 0]);
  assert.equal(lerpHeading(350, 10, 0.25), 355);
  assert.equal(indexAt(track, -1), -1);
  assert.equal(indexAt(track, 2500), 2);
});

test('traveledCoords ends at the rover and drops stationary duplicates', () => {
  assert.deepEqual(traveledCoords(track, -1), []);
  assert.deepEqual(traveledCoords(track, 2500), [[0, 0], [0.001, 0], [0.0015, 0]]);
});

test('siteStatusAt walks pending → inspecting → final status', () => {
  const site = {status: 'hazards', arrivedAt: 100, departedAt: 200} as Site;
  assert.equal(siteStatusAt(site, 99), 'pending');
  assert.equal(siteStatusAt(site, 100), 'inspecting');
  assert.equal(siteStatusAt(site, 200), 'hazards');
  assert.equal(siteStatusAt({...site, arrivedAt: undefined}, 500), 'pending');
});

test('mock mission: 5 sites on a ~4 km loop back to base, every final status, sites on the track', () => {
  const [m] = MOCK_MISSIONS;
  assert.equal(m.sites.length, 5);
  assert.ok(missionDistanceM(m) > 3000 && missionDistanceM(m) < 4500);
  assert.equal(m.endedAt! - m.startedAt, (1 * 3600 + 42 * 60 + 30) * 1000);
  for (const {track, plannedRoute} of MOCK_MISSIONS) {
    assert.ok(distanceM(plannedRoute![0], plannedRoute!.at(-1)!) < 1, 'route is a closed loop');
    assert.ok(distanceM(track[0].coord, track.at(-1)!.coord) < 1, 'rover ends where it started');
  }
  assert.deepEqual(new Set(m.sites.map(s => s.status)), new Set(['cleared', 'hazards', 'failed']));
  for (const {track} of MOCK_MISSIONS) for (let i = 1; i < track.length; i++) assert.ok(track[i].t > track[i - 1].t, 'track is strictly time-ordered');
  for (const s of m.sites) {
    assert.ok(distanceM(poseAt(m.track, s.arrivedAt! + 60_000)!.coord, s.coord) < 1, `${s.id}: rover is on site while dwelling`);
    assert.ok(s.departedAt! > s.arrivedAt!);
  }
  assert.equal(new Set(MOCK_MISSIONS.flatMap(x => x.sites.map(s => s.id))).size, 6, 'site ids are unique across rovers');
});

test('distanceAlongM grows with time and matches the full track length at the end', async () => {
  const {distanceAlongM, lineLengthM} = await import('../src/mission/track.ts');
  const [m] = MOCK_MISSIONS;
  const half = distanceAlongM(m.track, (m.startedAt + m.endedAt!) / 2);
  assert.equal(distanceAlongM(m.track, m.startedAt - 1), 0);
  assert.ok(half > 500 && half < 4000);
  assert.ok(Math.abs(distanceAlongM(m.track, m.endedAt!) - lineLengthM(m.track.map(p => p.coord))) < 1);
});

test('missionEvents lists departure, per-site arrival/scan/hazards, and return in time order', async () => {
  const {missionEvents} = await import('../src/mission/events.ts');
  const events = missionEvents(MOCK_MISSIONS[0]);
  assert.equal(events[0].label, 'Departed base');
  assert.equal(events.at(-1)!.label, 'Returned to base');
  assert.equal(events.filter(e => e.kind === 'arrive').length, 5);
  assert.equal(events.filter(e => e.kind === 'scan-failed').length, 1);
  assert.deepEqual(events.filter(e => e.kind === 'hazards').map(e => e.label), ['2 hazards flagged', '3 hazards flagged']);
  assert.ok(events.every((e, i) => i === 0 || e.t >= events[i - 1].t));
});
