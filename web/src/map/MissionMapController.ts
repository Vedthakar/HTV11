// Imperative bridge between the MissionStore and MapLibre: route lines, rover markers, flags and the follow camera.
// Everything here runs on store frames, outside React.
import * as maplibregl from 'maplibre-gl';
import type {Feature,LineString} from 'geojson';
import type {GeoJSONSource} from 'maplibre-gl';
import type {MissionState, MissionStore} from '../mission/store.ts';
import {distanceM, poseAt, traveledCoords} from '../mission/track.ts';
import type {LngLat, Mission} from '../mission/types.ts';
import {ParticleTrail} from './ParticleTrail.ts';
import {createSitePing, type SitePingHandle} from './SitePing.ts';

export const DEFAULT_PITCH = 50;
const LINE_UPDATE_MS = 33;
const emptyLine = (coords: LngLat[] = []): Feature<LineString> =>
  ({type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: coords}});

interface MissionLayers { mission: Mission; rover: maplibregl.Marker; roverEl: HTMLElement; ends: maplibregl.Marker[]; lastLineAt: number; lastLen: number; }

export class MissionMapController {
  private layers = new Map<string, MissionLayers>();
  private flags = new Map<string, SitePingHandle>();
  private trail: ParticleTrail;
  private prev: MissionState | null = null;
  private unsubs: (() => void)[] = [];
  private followLockUntil = 0;
  private map: maplibregl.Map;
  private store: MissionStore;

  constructor(map: maplibregl.Map, store: MissionStore) {
    this.map = map; this.store = store;
    this.trail = new ParticleTrail(map, store); // before any marker, so markers draw above the particles
    this.sync(store.getSnapshot());
    this.unsubs.push(store.subscribe(() => this.sync(store.getSnapshot())));
    this.unsubs.push(store.onFrame(t => this.frame(t)));
    const detach = (e: {originalEvent?: unknown}) => { if (e.originalEvent) store.detachFollow(); };
    map.on('dragstart', detach);
    this.unsubs.push(() => map.off('dragstart', detach));
  }

  /** Padding that keeps a focused point clear of the detail panel / bottom sheet. */
  private focusPadding() {
    // Phone: band between the telemetry strip and the bottom sheet (44vh) stacked on the log controls (see mission.css).
    // Wide: clear of the mission log on the left and the site panel on the right.
    return innerWidth <= 760 ? {top: 240, bottom: innerHeight * 0.44 + 150, left: 0, right: 0} : {top: 0, bottom: 0, left: 340, right: 400};
  }

  flyToSite(id: string) {
    const found = this.store.findSite(id);
    if (!found) return;
    this.store.detachFollow();
    const camera = {center: found.site.coord, zoom: 17, pitch: this.map.getPitch(), padding: this.focusPadding()};
    // MapLibre's reduced-motion fallback for flyTo drops `padding`, which would park the site under the panel.
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.map.jumpTo(camera);
    else this.map.flyTo({...camera, duration: 1600});
  }

  flyToRover(missionId: string) {
    const mission = this.store.getSnapshot().missions.find(m => m.id === missionId);
    const pose = mission && poseAt(mission.track, this.store.time);
    const target = pose?.coord ?? mission?.plannedRoute?.[0];
    if (target) this.map.flyTo({center: target, zoom: Math.max(this.map.getZoom(), 15.5), duration: 1400});
  }

  private sync(state: MissionState) {
    const prev = this.prev;
    this.prev = state;
    if (!prev || prev.missions !== state.missions) this.syncMissions(state.missions);
    if (!prev || prev.missions !== state.missions || prev.statusKey !== state.statusKey || prev.mode !== state.mode) this.syncFlags(state);
    if (!prev || prev.activeId !== state.activeId || prev.missions !== state.missions) {
      for (const [id, l] of this.layers) {
        l.roverEl.classList.toggle('is-active', id === state.activeId);
        for (const m of l.ends) m.getElement().hidden = id !== state.activeId; // START/END for the active rover only
      }
    }
    if (state.follow && !prev?.follow) {
      const pose = poseAt(this.store.active.track, this.store.time);
      if (pose) {
        this.followLockUntil = performance.now() + 900;
        this.map.easeTo({center: pose.coord, zoom: Math.max(this.map.getZoom(), 15.2), duration: 900});
      }
    }
  }

  private syncMissions(missions: Mission[]) {
    const ids = new Set(missions.map(m => m.id));
    for (const [id, l] of this.layers) if (!ids.has(id)) this.removeMission(id, l);
    // Below the 3D buildings, so the route shows through them. With 3D terrain on, lines added there don't
    // re-drape (MapLibre 5.6), so they go above the buildings instead.
    const style = this.map.getStyle().layers;
    const under = this.map.getTerrain() ? undefined : style.find(l => l.type === 'fill-extrusion');
    const beforeId = (under ?? style.find(l => l.type === 'symbol'))?.id;
    for (const mission of missions) {
      const existing = this.layers.get(mission.id);
      if (existing) { existing.mission = mission; existing.lastLen = -1; this.updateEnds(existing); continue; }
      const color = mission.color ?? '#F25C24', id = mission.id;
      this.map.addSource(`planned-${id}`, {type: 'geojson', data: emptyLine(mission.plannedRoute ?? [])});
      this.map.addSource(`done-${id}`, {type: 'geojson', data: emptyLine()});
      this.map.addLayer({id: `planned-${id}`, type: 'line', source: `planned-${id}`, layout: {'line-cap': 'butt', 'line-join': 'round'},
        paint: {'line-color': '#6B757D', 'line-opacity': 0.45, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.4, 17, 2.6], 'line-dasharray': [1.5, 2]}}, beforeId);
      this.map.addLayer({id: `glow-${id}`, type: 'line', source: `done-${id}`, layout: {'line-join': 'round', 'line-cap': 'round'},
        paint: {'line-color': color, 'line-opacity': 0.16, 'line-blur': 4, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5, 17, 12]}}, beforeId);
      // Zero-length dashes with round caps draw as dots: the driven path reads as a trail of scan points.
      this.map.addLayer({id: `done-${id}`, type: 'line', source: `done-${id}`, layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2.6, 17, 4.4], 'line-dasharray': [0, 1.7]}}, beforeId);

      const roverEl = document.createElement('div');
      roverEl.className = 'rover-marker';
      roverEl.style.setProperty('--accent', color);
      roverEl.innerHTML = '<span class="rover-halo"></span><span class="rover-wedge"></span><span class="rover-dot"></span>';
      roverEl.setAttribute('aria-hidden', 'true');
      const rover = new maplibregl.Marker({element: roverEl, rotationAlignment: 'map', pitchAlignment: 'map'})
        .setLngLat(mission.track[0]?.coord ?? mission.plannedRoute?.[0] ?? [0, 0]).addTo(this.map);
      const layers: MissionLayers = {mission, rover, roverEl, ends: [], lastLineAt: 0, lastLen: -1};
      this.layers.set(id, layers);
      this.updateEnds(layers);
    }
    this.store.invalidate();
  }

  /** "[ START ]" and "[ END ]" labels, or a single "[ BASE ]" when the route is a loop. */
  private updateEnds(l: MissionLayers) {
    for (const m of l.ends) m.remove();
    const route = l.mission.plannedRoute ?? l.mission.track.map(p => p.coord);
    if (route.length < 2) { l.ends = []; return; }
    const start = route[0], end = route[route.length - 1], loop = distanceM(start, end) < 40;
    const label = (text: string, cls: string) => {
      const el = document.createElement('div');
      el.className = `route-end ${cls}`;
      el.innerHTML = `<span>[ ${text} ]</span>`;
      return el;
    };
    const dot = document.createElement('div');
    dot.className = 'route-end-dot';
    l.ends = [new maplibregl.Marker({element: dot}).setLngLat(start).addTo(this.map)];
    if (loop) {
      // A round trip starts and ends at the same base; one label below the point stays clear of site chips above.
      l.ends.push(new maplibregl.Marker({element: label('BASE', 'is-base'), anchor: 'top', offset: [0, 10]}).setLngLat(start).addTo(this.map));
    } else {
      l.ends.push(
        new maplibregl.Marker({element: label('START', 'is-start'), anchor: 'bottom', offset: [0, -10]}).setLngLat(start).addTo(this.map),
        new maplibregl.Marker({element: label('END', 'is-end'), anchor: 'top', offset: [0, 6]}).setLngLat(end).addTo(this.map),
      );
      const endDot = document.createElement('div');
      endDot.className = 'route-end-dot';
      l.ends.push(new maplibregl.Marker({element: endDot}).setLngLat(end).addTo(this.map));
    }
  }

  private removeMission(id: string, l: MissionLayers) {
    for (const layer of [`done-${id}`, `glow-${id}`, `planned-${id}`]) if (this.map.getLayer(layer)) this.map.removeLayer(layer);
    for (const src of [`done-${id}`, `planned-${id}`]) if (this.map.getSource(src)) this.map.removeSource(src);
    l.rover.remove();
    for (const m of l.ends) m.remove();
    this.layers.delete(id);
  }

  private syncFlags(state: MissionState) {
    const seen = new Set<string>();
    for (const mission of state.missions) for (const site of mission.sites) {
      seen.add(site.id);
      let flag = this.flags.get(site.id);
      if (!flag) {
        flag = createSitePing(site, this.map, id => { this.store.select(id); this.flyToSite(id); });
        this.flags.set(site.id, flag);
      }
      flag.setLngLat(site.coord);
      flag.update(site, this.store.siteStatus(site), this.store.siteVisible(site));
    }
    for (const [id, flag] of this.flags) if (!seen.has(id)) { flag.destroy(); this.flags.delete(id); }
  }

  private frame(time: number) {
    const now = performance.now(), state = this.store.getSnapshot();
    for (const [id, l] of this.layers) {
      const track = l.mission.track;
      const pose = poseAt(track, time);
      l.roverEl.hidden = !pose || time < track[0].t;
      if (!pose) continue;
      l.rover.setLngLat(pose.coord).setRotation(pose.heading);
      l.roverEl.classList.toggle('is-dwelling', pose.speed < 0.05);
      // Throttle GeoJSON re-tiling; always update when paused/seeking so the line never lags the marker.
      const moving = state.playing || state.mode === 'live';
      if (!moving || now - l.lastLineAt > LINE_UPDATE_MS || l.lastLen < 0) {
        const coords = traveledCoords(track, time);
        (this.map.getSource(`done-${id}`) as GeoJSONSource | undefined)?.setData(emptyLine(coords));
        l.lastLineAt = now; l.lastLen = coords.length;
      }
      if (id === state.activeId && state.follow && now > this.followLockUntil && !this.map.isMoving()) this.map.setCenter(pose.coord);
    }
  }

  destroy() {
    for (const off of this.unsubs) off();
    this.trail.destroy();
    for (const [id, l] of this.layers) this.removeMission(id, l);
    for (const flag of this.flags.values()) flag.destroy();
    this.flags.clear();
  }
}
