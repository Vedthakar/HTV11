// Telemetry feeds for LIVE mode. Both sources emit the same TelemetryEvent messages, so the store does not
// care whether points come from the bundled demo mission or from a real rover.
import type {Mission, Site, TelemetryPoint} from './types.ts';

/**
 * Wire format (one JSON object per WebSocket text message):
 *   {"type":"mission","mission":{...Mission, "track":[]}}         snapshot; send first, and again on reconnect
 *   {"type":"telemetry","missionId":"M-1017-A","point":{"t":1792256700000,"coord":[-79.40,43.64],"heading":212,"speed":1.3,"batteryPct":88,"signalPct":74}}
 *   {"type":"site","missionId":"M-1017-A","site":{"id":"SITE-03","status":"inspecting","arrivedAt":1792258000000}}
 *   {"type":"end","missionId":"M-1017-A","endedAt":1792264509000}
 * `site` is a partial update merged into the site with that id. Times are epoch ms, coords [lng, lat].
 */
export type TelemetryEvent =
  | {type: 'mission'; mission: Mission}
  | {type: 'telemetry'; missionId: string; point: TelemetryPoint}
  | {type: 'site'; missionId: string; site: Partial<Site> & {id: string}}
  | {type: 'end'; missionId: string; endedAt: number};

export type FeedStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface TelemetrySource {
  /** How fast mission time advances per real second (1 for a real rover). Used to keep LIVE motion smooth. */
  readonly rate: number;
  readonly isMock: boolean;
  connect(): void;
  disconnect(): void;
  subscribe(listener: (event: TelemetryEvent) => void): () => void;
  onStatus(listener: (status: FeedStatus) => void): () => void;
}

abstract class BaseSource {
  private listeners = new Set<(e: TelemetryEvent) => void>();
  private statusListeners = new Set<(s: FeedStatus) => void>();
  subscribe(listener: (e: TelemetryEvent) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  onStatus(listener: (s: FeedStatus) => void) { this.statusListeners.add(listener); return () => { this.statusListeners.delete(listener); }; }
  protected emit(e: TelemetryEvent) { for (const l of this.listeners) l(e); }
  protected setStatus(s: FeedStatus) { for (const l of this.statusListeners) l(s); }
}

/** The part of a mission known before it starts: route and planned sites, no track or inspection results. */
export function missionSkeleton(m: Mission): Mission {
  return {
    ...m, track: [], endedAt: undefined, plannedEndAt: m.endedAt ?? m.plannedEndAt,
    sites: m.sites.map(s => ({...s, status: 'pending', arrivedAt: undefined, departedAt: undefined, hazards: [], reportStatus: 'draft'})),
  };
}

/** Re-runs bundled missions as if they were live, `rate`× faster than real time. */
export class MockTelemetrySource extends BaseSource implements TelemetrySource {
  readonly isMock = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private missions: Mission[];
  readonly rate: number;
  private startOffsetMs: number;

  constructor(missions: Mission[], {rate = 30, startOffsetMs = 0} = {}) {
    super();
    this.missions = missions; this.rate = rate; this.startOffsetMs = startOffsetMs;
  }

  connect() {
    if (this.timer) return;
    this.setStatus('connecting');
    const t0 = Math.min(...this.missions.map(m => m.startedAt)) + this.startOffsetMs;
    const cursor = this.missions.map(() => 0);
    const sent = new Set<string>();
    const once = (key: string) => !sent.has(key) && !!sent.add(key);
    for (const m of this.missions) this.emit({type: 'mission', mission: missionSkeleton(m)});
    this.setStatus('open');
    const realStart = performance.now();
    const tick = () => {
      const clock = t0 + (performance.now() - realStart) * this.rate;
      this.missions.forEach((m, k) => {
        for (; cursor[k] < m.track.length && m.track[cursor[k]].t <= clock; cursor[k]++)
          this.emit({type: 'telemetry', missionId: m.id, point: m.track[cursor[k]]});
        for (const s of m.sites) {
          if (s.arrivedAt != null && clock >= s.arrivedAt && once(s.id + ':a'))
            this.emit({type: 'site', missionId: m.id, site: {id: s.id, status: 'inspecting', arrivedAt: s.arrivedAt}});
          if (s.departedAt != null && clock >= s.departedAt && once(s.id + ':d'))
            this.emit({type: 'site', missionId: m.id, site: {...s}});
        }
        if (m.endedAt != null && clock >= m.endedAt && once(m.id + ':end'))
          this.emit({type: 'end', missionId: m.id, endedAt: m.endedAt});
      });
    };
    tick();
    this.timer = setInterval(tick, 250);
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setStatus('closed');
  }
}

/**
 * Real rover feed over WebSocket, speaking the wire format documented at the top of this file.
 * TODO(rover-backend): add the /api/rover/telemetry endpoint to backend/main.py (Vite already proxies /api with ws).
 * TODO: authenticate (e.g. reuse the capture token) and resume from the last received `t` on reconnect.
 */
export class WebSocketTelemetrySource extends BaseSource implements TelemetrySource {
  readonly rate = 1;
  readonly isMock = false;
  private ws: WebSocket | null = null;
  private retry = 0;
  private closedByUser = false;
  private url: string;

  constructor(url = defaultTelemetryUrl()) { super(); this.url = url; }

  connect() {
    this.closedByUser = false;
    this.setStatus('connecting');
    const ws = this.ws = new WebSocket(this.url);
    ws.onopen = () => { this.retry = 0; this.setStatus('open'); };
    ws.onmessage = msg => {
      try {
        const event = JSON.parse(msg.data) as TelemetryEvent;
        if (event && typeof event.type === 'string') this.emit(event);
      } catch { console.warn('[telemetry] ignoring malformed message', msg.data); }
    };
    ws.onerror = () => this.setStatus('error');
    ws.onclose = () => {
      this.ws = null;
      this.setStatus('closed');
      if (!this.closedByUser) setTimeout(() => this.connect(), Math.min(15000, 1000 * 2 ** this.retry++));
    };
  }

  disconnect() { this.closedByUser = true; this.ws?.close(); }
}

export function defaultTelemetryUrl(): string {
  const configured = import.meta.env?.VITE_ROVER_TELEMETRY_URL as string | undefined;
  if (configured) return configured;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/rover/telemetry`;
}

/** WebSocket when VITE_ROVER_TELEMETRY_URL is set or the page has ?telemetry=ws; the demo feed otherwise. */
export function createTelemetrySource(missions: Mission[]): TelemetrySource {
  const wantsSocket = import.meta.env?.VITE_ROVER_TELEMETRY_URL || new URLSearchParams(location.search).get('telemetry') === 'ws';
  return wantsSocket ? new WebSocketTelemetrySource() : new MockTelemetrySource(missions, {rate: 30});
}
