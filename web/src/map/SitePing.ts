// A site on the map as a LiDAR ping: rings sweep outward on the ground, a reticle locks on, then a status chip
// with a mini scan thumbnail slides out. Two markers: one lies flat on the ground (rings), one stays upright
// (reticle + chip) so the text is readable when the map is tilted. Built imperatively: it changes on the frame path.
import * as maplibregl from 'maplibre-gl';
import {clock, STATUS_META} from '../mission/format.ts';
import type {Site, SiteStatus} from '../mission/types.ts';
import {scanThumbnailSvg} from './scanThumbnail.ts';

export interface SitePingHandle {
  update(site: Site, status: SiteStatus, visible: boolean): void;
  setLngLat(coord: [number, number]): void;
  destroy(): void;
}

export function createSitePing(site: Site, map: maplibregl.Map, onSelect: (id: string) => void): SitePingHandle {
  const ground = document.createElement('div');
  ground.className = 'site-ground';
  ground.setAttribute('aria-hidden', 'true');
  ground.innerHTML = '<span class="ping-ring"></span><span class="ping-ring"></span><span class="ping-ring"></span><span class="ground-mark"></span>';

  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'site-ping';
  el.innerHTML = `
    <span class="reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
    <span class="ping-leader" aria-hidden="true"></span>
    <span class="ping-chip" aria-hidden="true">
      <span class="chip-thumb"></span>
      <span class="chip-text"><b class="chip-id"></b><small class="chip-status"></small></span>
    </span>
    <span class="ping-tip" role="tooltip"></span>`;
  const $ = (s: string) => el.querySelector(s) as HTMLElement;
  el.addEventListener('click', e => { e.stopPropagation(); onSelect(site.id); });

  const groundMarker = new maplibregl.Marker({element: ground, pitchAlignment: 'map', rotationAlignment: 'map'}).setLngLat(site.coord).addTo(map);
  const marker = new maplibregl.Marker({element: el, anchor: 'center'}).setLngLat(site.coord).addTo(map);
  let shown: boolean | null = null, lastStatus: SiteStatus | null = null, thumbKey = '';

  return {
    update(next, status, visible) {
      const meta = STATUS_META[status];
      const hazards = status === 'hazards' ? ` · ${next.hazards.length} hazard${next.hazards.length === 1 ? '' : 's'}` : '';
      el.dataset.status = ground.dataset.status = status;
      $('.chip-id').textContent = next.label;
      $('.chip-status').textContent = status === 'pending' ? 'PENDING'
        : status === 'inspecting' ? `${clock(next.arrivedAt)} · SCANNING`
        : `${clock(next.arrivedAt)} · ${meta.icon} ${status === 'hazards' ? `${next.hazards.length} HAZARD${next.hazards.length === 1 ? '' : 'S'}` : meta.label.toUpperCase()}`;
      $('.ping-tip').textContent = `${next.label} · ${next.area} · ${meta.label}${hazards}`;
      el.setAttribute('aria-label', `${next.label}, ${next.area}: ${meta.label}${hazards}. Arrived ${clock(next.arrivedAt)}. Open details.`);
      // The thumbnail appears once the rover is on site; regenerate only when the scan result changes.
      const key = status === 'pending' ? '' : `${status}:${next.hazards.length}`;
      if (key !== thumbKey) { $('.chip-thumb').innerHTML = key ? scanThumbnailSvg({...next, status}) : ''; thumbKey = key; }
      el.hidden = ground.hidden = !visible;
      el.tabIndex = visible ? 0 : -1;
      // Ping when a site first appears (replay) or the rover arrives (live).
      const arrived = lastStatus === 'pending' && status !== 'pending';
      if (visible && (shown === false || arrived)) {
        for (const node of [el, ground]) { node.classList.remove('is-pinging'); void node.offsetWidth; node.classList.add('is-pinging'); }
      }
      shown = visible; lastStatus = status;
    },
    setLngLat(coord) { groundMarker.setLngLat(coord); marker.setLngLat(coord); },
    destroy() { groundMarker.remove(); marker.remove(); },
  };
}
