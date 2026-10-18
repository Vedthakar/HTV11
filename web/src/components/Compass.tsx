import type * as maplibregl from 'maplibre-gl';
import {useEffect, useRef} from 'react';
import {DEFAULT_PITCH} from '../map/MissionMapController.ts';

export function resetNorth(map: maplibregl.Map) {
  map.easeTo({bearing: 0, pitch: DEFAULT_PITCH, duration: 700});
}

/** "N" button that rotates with the map's bearing; click resets bearing and pitch. */
export function Compass({map}: {map: maplibregl.Map | null}) {
  const needle = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!map) return;
    const update = () => { if (needle.current) needle.current.style.transform = `rotate(${-map.getBearing()}deg)`; };
    map.on('rotate', update);
    update();
    return () => { map.off('rotate', update); };
  }, [map]);
  return (
    <button className="compass" onClick={() => map && resetNorth(map)} aria-label="Reset map to north" aria-keyshortcuts="N">
      <span ref={needle} className="compass-needle"><span className="compass-tick" aria-hidden="true" />N</span>
    </button>
  );
}
