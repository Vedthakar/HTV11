import test from 'node:test';
import assert from 'node:assert/strict';
import {MockTelemetrySource, missionSkeleton, type TelemetryEvent} from '../src/mission/telemetry.ts';
import {MOCK_MISSIONS} from '../src/mission/mock-mission.ts';

test('missionSkeleton hides inspection results until the feed reports them', () => {
  const skeleton = missionSkeleton(MOCK_MISSIONS[0]);
  assert.equal(skeleton.track.length, 0);
  assert.equal(skeleton.endedAt, undefined);
  assert.equal(skeleton.plannedEndAt, MOCK_MISSIONS[0].endedAt);
  assert.ok(skeleton.sites.every(s => s.status === 'pending' && s.arrivedAt == null && s.hazards.length === 0));
});

test('MockTelemetrySource replays snapshot, points in order, then arrival before departure for each site', async () => {
  const mission = MOCK_MISSIONS[1]; // short ROVER-02 mission (31 min)
  const source = new MockTelemetrySource([mission], {rate: 20_000}); // whole mission in well under a second
  const events: TelemetryEvent[] = [];
  source.subscribe(e => events.push(e));
  source.connect();
  await new Promise(resolve => setTimeout(resolve, 600));
  source.disconnect();

  assert.equal(events[0].type, 'mission');
  const points = events.flatMap(e => (e.type === 'telemetry' ? [e.point.t] : []));
  assert.equal(points.length, mission.track.length, 'every point is sent exactly once');
  assert.ok(points.every((t, i) => i === 0 || t > points[i - 1]));
  const siteEvents = events.flatMap(e => (e.type === 'site' ? [e.site] : []));
  assert.deepEqual(siteEvents.map(s => s.status), ['inspecting', 'cleared']);
  assert.equal(events.at(-1)!.type, 'end');
});
