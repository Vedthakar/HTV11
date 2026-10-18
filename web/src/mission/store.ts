// Mission playback state. Two channels keep React off the per-frame path:
//   - onFrame(cb): every animation frame the clock moves, for imperative map/DOM updates
//   - subscribe/getSnapshot: discrete state (mode, playing, site statuses…) for React via useSyncExternalStore
import {isSiteReached, missionEnd, siteStatusAt} from './track.ts';
import {createTelemetrySource, type FeedStatus, type TelemetryEvent, type TelemetrySource} from './telemetry.ts';
import type {Mission, ReportStatus, Site, SiteStatus} from './types.ts';

export type Mode = 'replay' | 'live';
export const SPEEDS = [1, 10, 30, 60] as const;
export type Speed = typeof SPEEDS[number];

export interface MissionState {
  mode: Mode;
  playing: boolean;
  speed: Speed;
  missions: Mission[];       // dataset for the current mode
  activeId: string;
  statusKey: string;         // changes whenever any flag's visible status changes
  follow: boolean;
  followDetached: boolean;   // follow was on but the user panned away
  selectedSiteId: string | null;
  feed: FeedStatus;
  isMock: boolean;
  liveComplete: boolean;
  reportOverrides: Record<string, ReportStatus>;
}

type FrameListener = (time: number) => void;

export class MissionStore {
  /** Mission clock (epoch ms). Read it in frame listeners; it is deliberately not part of the React snapshot. */
  time: number;
  private state: MissionState;
  private listeners = new Set<() => void>();
  private frameListeners = new Set<FrameListener>();
  private replayMissions: Mission[];
  private liveMissions = new Map<string, Mission>();
  private source: TelemetrySource | null = null;
  private unsubSource: (() => void)[] = [];
  private raf = 0;
  private last = 0;
  private dirty = true;
  private liveClock: number | null = null;

  private makeSource: (missions: Mission[]) => TelemetrySource;

  constructor(replayMissions: Mission[], makeSource: (missions: Mission[]) => TelemetrySource = createTelemetrySource) {
    this.replayMissions = replayMissions;
    this.makeSource = makeSource;
    this.time = replayMissions[0].startedAt;
    this.state = {
      mode: 'replay', playing: false, speed: 30, missions: replayMissions, activeId: replayMissions[0].id,
      statusKey: '', follow: false, followDetached: false, selectedSiteId: null, feed: 'closed',
      isMock: true, liveComplete: false, reportOverrides: {},
    };
    this.state.statusKey = this.computeStatusKey();
  }

  // React channel
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private set(patch: Partial<MissionState>) { this.state = {...this.state, ...patch}; for (const l of this.listeners) l(); }

  // Frame channel
  onFrame(listener: FrameListener) { this.frameListeners.add(listener); listener(this.time); return () => { this.frameListeners.delete(listener); }; }
  invalidate() { this.dirty = true; }

  get active(): Mission { return this.state.missions.find(m => m.id === this.state.activeId) ?? this.state.missions[0]; }
  get span(): [number, number] { const m = this.active; return [m.startedAt, Math.max(missionEnd(m), m.startedAt + 1)]; }

  findSite(id: string | null): {site: Site; mission: Mission} | null {
    for (const mission of this.state.missions) for (const site of mission.sites) if (site.id === id) return {site, mission};
    return null;
  }
  siteStatus(site: Site): SiteStatus { return siteStatusAt(site, this.time); }
  /** In replay, flags appear only once the rover reaches the site; LIVE shows planned sites as pending. */
  siteVisible(site: Site): boolean { return this.state.mode === 'live' || isSiteReached(site, this.time); }
  reportStatus(site: Site): ReportStatus { return this.state.reportOverrides[site.id] ?? site.reportStatus; }

  // Playback controls
  play() {
    if (this.state.mode !== 'replay') return;
    const [start, end] = this.span;
    if (this.time >= end) this.time = start; // replay from the top
    this.dirty = true;
    this.set({playing: true});
  }
  pause() { this.set({playing: false}); }
  toggle() { this.state.playing ? this.pause() : this.play(); }
  seek(time: number) {
    if (this.state.mode === 'live') this.setMode('replay');
    const [start, end] = this.span;
    this.time = Math.min(end, Math.max(start, time));
    this.dirty = true;
  }
  seekBy(deltaMs: number) { this.seek(this.time + deltaMs); }
  setSpeed(speed: Speed) { this.set({speed}); }

  setMode(mode: Mode) {
    if (mode === this.state.mode) return;
    if (mode === 'live') {
      this.connectLive();
      const missions = [...this.liveMissions.values()];
      this.set({mode, playing: false, missions: missions.length ? missions : this.replayMissions, follow: true, followDetached: false});
    } else {
      this.disconnectLive();
      const [start, end] = [this.replayMissions[0].startedAt, missionEnd(this.replayMissions[0])];
      this.time = Math.min(end, Math.max(start, this.time));
      this.set({mode, missions: this.replayMissions, liveComplete: false, feed: 'closed'});
    }
    this.dirty = true;
  }

  loadSurvey(mission: Mission) {
    this.disconnectLive();this.source=null;this.liveMissions.clear();
    this.replayMissions=[mission];this.time=mission.startedAt;this.last=0;this.dirty=true;
    this.set({mode:'replay',missions:[mission],activeId:mission.id,playing:true,selectedSiteId:null,reportOverrides:{},follow:true,followDetached:false,isMock:true,liveComplete:false,feed:'closed'});
  }
  stopSurvey() { if(this.active.id.startsWith('SURVEY-'))this.pause(); }
  setActive(id: string) { this.set({activeId: id}); this.dirty = true; }
  select(siteId: string | null) { this.set({selectedSiteId: siteId}); }
  setFollow(follow: boolean) { this.set({follow, followDetached: false}); this.dirty = true; }
  /** Called by the map when the user pans while following. */
  detachFollow() { if (this.state.follow) this.set({follow: false, followDetached: true}); }

  /** Draft → awaiting operator confirmation → submitted. TODO(reporting-agent): submitting will hand off to the agent. */
  advanceReport(siteId: string) {
    const found = this.findSite(siteId);
    if (!found) return;
    const next: Record<ReportStatus, ReportStatus> = {draft: 'awaiting_confirmation', awaiting_confirmation: 'submitted', submitted: 'submitted'};
    const status = next[this.reportStatus(found.site)];
    if (status === 'submitted') console.info('[reports] submit stub: would hand', siteId, 'to the reporting agent');
    this.set({reportOverrides: {...this.state.reportOverrides, [siteId]: status}});
  }

  // LIVE feed
  private connectLive() {
    this.source ??= this.makeSource(this.replayMissions);
    this.liveMissions.clear();
    this.liveClock = null;
    this.unsubSource = [
      this.source.subscribe(e => this.onTelemetry(e)),
      this.source.onStatus(feed => this.set({feed})),
    ];
    this.set({isMock: this.source.isMock, liveComplete: false});
    this.source.connect();
  }
  private disconnectLive() {
    for (const off of this.unsubSource) off();
    this.unsubSource = [];
    this.source?.disconnect();
  }

  private onTelemetry(e: TelemetryEvent) {
    if (e.type === 'mission') {
      this.liveMissions.set(e.mission.id, structuredClone(e.mission));
      const missions = [...this.liveMissions.values()];
      this.set({missions, activeId: missions.some(m => m.id === this.state.activeId) ? this.state.activeId : missions[0].id});
    } else {
      const m = this.liveMissions.get(e.missionId);
      if (!m) return;
      if (e.type === 'telemetry') m.track.push(e.point);
      else if (e.type === 'end') { m.endedAt = e.endedAt; this.set({missions: [...this.liveMissions.values()]}); }
      else {
        m.sites = m.sites.map(s => s.id === e.site.id ? {...s, ...e.site} : s);
        this.set({missions: [...this.liveMissions.values()]});
      }
    }
    this.dirty = true;
  }

  /** LIVE display clock: runs at the feed's rate, trailing the newest point slightly so motion never stalls. */
  private advanceLive(dtMs: number) {
    const latest = Math.max(...[...this.liveMissions.values()].map(m => m.track[m.track.length - 1]?.t ?? -Infinity));
    if (!Number.isFinite(latest)) return;
    const rate = this.source?.rate ?? 1, lag = 2500 * Math.max(1, rate / 10);
    const target = latest - lag;
    if (this.liveClock == null || target - this.liveClock > lag * 6) this.liveClock = target; // first point, or tab was hidden
    const catchUp = Math.min(2, Math.max(0.5, 1 + (target - this.liveClock) / (lag * 2)));
    this.liveClock = Math.min(latest, this.liveClock + dtMs * rate * catchUp);
    if (this.liveClock !== this.time) { this.time = this.liveClock; this.dirty = true; }
    const done = [...this.liveMissions.values()].every(m => m.endedAt != null && this.time >= m.endedAt);
    if (done !== this.state.liveComplete) this.set({liveComplete: done});
  }

  // Animation loop
  start() {
    const loop = (now: number) => {
      const dt = this.last ? Math.min(100, now - this.last) : 0;
      this.last = now;
      if (this.state.mode === 'replay' && this.state.playing) {
        const [, end] = this.span;
        this.time = Math.min(end, this.time + dt * this.state.speed);
        this.dirty = true;
        if (this.time >= end) this.set({playing: false});
      } else if (this.state.mode === 'live') this.advanceLive(dt);
      if (this.dirty) {
        this.dirty = false;
        for (const l of this.frameListeners) l(this.time);
        const key = this.computeStatusKey();
        if (key !== this.state.statusKey) this.set({statusKey: key});
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  destroy() { cancelAnimationFrame(this.raf); this.disconnectLive(); }

  private computeStatusKey() {
    return this.state.missions.map(m => m.sites.map(s => (this.siteVisible(s) ? this.siteStatus(s) : '-')).join(',')).join('|');
  }
}
