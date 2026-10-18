import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import {addCivicOverlay} from '../map/civic-overlay.js';
maplibregl.setWorkerUrl(workerUrl);
import {useEffect, useRef} from 'react';
import {buildMissionStyle, registerPointCloudImages} from '../map/restyle.ts';
import {DEFAULT_PITCH, MissionMapController} from '../map/MissionMapController.ts';
import {useMissionStore} from '../mission/useMissionPlayback.ts';

export const DEFAULT_BEARING = -15;

interface Props { onReady(map: maplibregl.Map, controller: MissionMapController): void; }

export function MapView({onReady}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const store = useMissionStore();

  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: buildMissionStyle({terrain: new URLSearchParams(location.search).get('terrain') === '1'}),
      center: [-79.385,43.653], zoom: 15, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING,
      minZoom: 11, maxZoom: 19, maxPitch: 70,
      attributionControl: false,
      canvasContextAttributes: {antialias: true},
    });
    registerPointCloudImages(map);
    map.addControl(new maplibregl.AttributionControl({compact: false}), 'bottom-right');
    map.touchZoomRotate.enableRotation();

    // Terrain/hillshade are nice-to-haves: if the DEM tiles fail, drop them and keep a flat map.
    let terrainOff = false;
    map.on('error', e => {
      const sourceId = (e as {sourceId?: string}).sourceId;
      if (!sourceId?.endsWith('-dem')) { console.error('[map]', e.error); return; }
      if (terrainOff) return;
      terrainOff = true;
      console.warn('[map] terrain tiles unavailable; continuing without terrain', e.error);
      map.setTerrain(null);
      if (map.getLayer('hillshade')) map.removeLayer('hillshade');
    });

    if (import.meta.env.DEV) (window as unknown as {missionMap: maplibregl.Map}).missionMap = map;

    let controller: MissionMapController | null = null;
    let cleanupCivic: (() => void) | undefined;
    let disposed=false;
    map.once('load', () => {
      store.setFollow(false);
      if(store.getSnapshot().playing)store.toggle();
      controller = new MissionMapController(map, store);
      addCivicOverlay(map,(target: {key:string;label:string})=>{store.detachFollow();window.dispatchEvent(new CustomEvent('rover:building-selected',{detail:target}));}).then(cleanup=>{if(disposed)cleanup?.();else cleanupCivic=cleanup;});
      onReady(map, controller);
    });
    return () => { disposed=true;cleanupCivic?.();controller?.destroy(); map.remove(); };
    // The map is created once; store and onReady are stable for the app's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={container} className="map-canvas" role="region" aria-label="Mission map. Drag to pan, scroll to zoom, right-drag or Ctrl-drag to rotate and tilt." />;
}
