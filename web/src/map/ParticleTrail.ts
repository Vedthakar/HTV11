// Rover particle trail, drawn on a 2D canvas between the map's WebGL canvas and its markers.
// Moving rovers shed fading particles; a rover dwelling at a site gives off a small radial "LiDAR spray".
import type maplibregl from 'maplibre-gl';
import type {MissionStore} from '../mission/store.ts';
import {poseAt} from '../mission/track.ts';
import type {LngLat} from '../mission/types.ts';

const PARTICLE_LIFE_MS = 2200;
const MAX_PARTICLES = 500;

interface Particle { lngLat: LngLat; born: number; dx: number; dy: number; vx: number; vy: number; r: number; color: string; }

export class ParticleTrail {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private raf = 0;
  private lastPose = new Map<string, LngLat>();
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private offs: (() => void)[] = [];
  private map: maplibregl.Map;
  private store: MissionStore;

  constructor(map: maplibregl.Map, store: MissionStore) {
    this.map = map; this.store = store;
    this.canvas.className = 'trail-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    // Right after the WebGL canvas, so markers (appended later) stay above the particles.
    map.getCanvas().after(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    // Camera moves only matter while particles are on screen.
    const onRender = () => { if (this.particles.length) this.schedule(); };
    map.on('render', onRender);
    this.offs.push(() => map.off('render', onRender));
    this.offs.push(store.onFrame(t => { this.emit(t); if (this.particles.length) this.schedule(); }));
  }

  private schedule() { this.raf ||= requestAnimationFrame(() => { this.raf = 0; this.draw(); }); }

  private emit(time: number) {
    if (this.reduceMotion) return;
    const now = performance.now(), state = this.store.getSnapshot();
    const running = state.playing || state.mode === 'live';
    for (const m of state.missions) {
      const pose = poseAt(m.track, time);
      if (!pose || time < m.track[0].t || (m.endedAt != null && time >= m.endedAt)) continue;
      const prev = this.lastPose.get(m.id);
      this.lastPose.set(m.id, pose.coord);
      if (!running || !prev) continue;
      const color = m.color ?? '#F25C24';
      const moved = prev[0] !== pose.coord[0] || prev[1] !== pose.coord[1];
      const n = moved ? 5 : pose.speed < 0.05 ? 2 : 0;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, spray = !moved;
        const v = spray ? 18 + Math.random() * 26 : 3 + Math.random() * 6;
        this.particles.push({lngLat: pose.coord, born: now, color, r: spray ? 1.4 : 1.3 + Math.random() * 1.6,
          dx: (Math.random() - 0.5) * 9, dy: (Math.random() - 0.5) * 9, vx: Math.cos(a) * v, vy: Math.sin(a) * v});
      }
    }
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);
  }

  private draw() {
    const {clientWidth: w, clientHeight: h} = this.map.getContainer(), dpr = Math.min(devicePixelRatio, 2), ctx = this.ctx;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const now = performance.now();
    this.particles = this.particles.filter(p => now - p.born < PARTICLE_LIFE_MS);
    for (const p of this.particles) {
      const age = (now - p.born) / 1000, life = 1 - (now - p.born) / PARTICLE_LIFE_MS;
      const s = this.map.project(p.lngLat);
      ctx.globalAlpha = Math.pow(life, 1.6) * 0.85;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(s.x + p.dx + p.vx * age, s.y + p.dy + p.vy * age, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (this.particles.length) this.schedule(); // keep fading until the last particle is gone
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    for (const off of this.offs) off();
    this.canvas.remove();
  }
}
