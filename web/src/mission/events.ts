// Mission log entries derived from a mission: departure, arrivals, scan results, hazards, return.
import {distanceM, lineLengthM} from './track.ts';
import type {Mission, SiteStatus} from './types.ts';

export type MissionEventKind = 'depart' | 'arrive' | 'scan' | 'scan-failed' | 'hazards' | 'return';

export interface MissionEvent {
  id: string;
  t: number;
  kind: MissionEventKind;
  label: string;
  detail?: string;
  siteId?: string;
  status?: SiteStatus;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Time-ordered log. Sites the rover has not reached (no arrivedAt) contribute nothing yet. */
export function missionEvents(m: Mission): MissionEvent[] {
  const events: MissionEvent[] = [{id: `${m.id}:depart`, t: m.startedAt, kind: 'depart', label: 'Departed base', detail: m.roverId}];
  for (const s of m.sites) {
    if (s.arrivedAt == null) continue;
    events.push({id: `${s.id}:arrive`, t: s.arrivedAt, kind: 'arrive', label: `Arrived ${s.label}`, detail: s.area, siteId: s.id, status: 'inspecting'});
    if (s.departedAt == null || s.status === 'pending' || s.status === 'inspecting') continue;
    const onSite = `${Math.round((s.departedAt - s.arrivedAt) / 60000)} min on site`;
    if (s.status === 'failed') {
      events.push({id: `${s.id}:scan`, t: s.departedAt, kind: 'scan-failed', label: 'Scan incomplete', detail: `${onSite} · re-scan needed`, siteId: s.id, status: 'failed'});
      continue;
    }
    events.push({id: `${s.id}:scan`, t: s.departedAt, kind: 'scan', label: s.simulated?'Simulated stop complete':'Scan complete',
      detail: s.simulated?'Simulation only · no inspection performed':s.hazards.length ? onSite : `${onSite} · no hazards`, siteId: s.id, status: s.hazards.length ? 'hazards' : 'cleared'});
    if (s.hazards.length) events.push({id: `${s.id}:hazards`, t: s.departedAt, kind: 'hazards', label: `${plural(s.hazards.length, 'hazard')} flagged`,
      detail: s.hazards.map(h => h.type).join(', '), siteId: s.id, status: 'hazards'});
  }
  if (m.endedAt != null) {
    const route = m.plannedRoute ?? m.track.map(p => p.coord);
    const returned = route.length > 1 && distanceM(route[0], route[route.length - 1]) < 50;
    events.push({id: `${m.id}:return`, t: m.endedAt, kind: 'return', label: returned ? 'Returned to base' : 'Mission ended',
      detail: `${(lineLengthM(m.track.map(p => p.coord)) / 1000).toFixed(1)} km driven`});
  }
  // Stable sort keeps scan-before-hazards order for events sharing a timestamp.
  return events.sort((a, b) => a.t - b.t);
}
