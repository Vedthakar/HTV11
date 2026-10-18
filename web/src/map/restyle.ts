// Turns the forked OpenFreeMap "Liberty" style (liberty.json, unmodified upstream copy) into the light-grey
// "point cloud" basemap of the mission map: quiet streets, buildings drawn as dotted LiDAR-like textures. Keeping the palette here, rather than hand-editing the
// 40 KB JSON, makes the look reviewable and lets us pull upstream style fixes by re-downloading the file.
import type {LayerSpecification, RasterDEMSourceSpecification, StyleSpecification} from 'maplibre-gl';
import liberty from './liberty.json' with {type: 'json'};

export const PALETTE = {
  land: '#E4E7E9', landWarm: '#DFE3E5', park: '#DDE3DD', parkEdge: 'rgba(120,135,125,0.25)', wood: '#D8DFD8',
  water: '#D0D9DE', shore: '#B4C1C8', road: '#FAFBFB', roadMajor: '#FFFFFF', casing: '#D3D8DB', casingMajor: '#C5CCD0',
  rail: '#B9C0C5', buildingEdge: 'rgba(90,100,108,0.18)',
  label: '#7F878E', labelSoft: '#9AA2A8', waterLabel: '#7D919C', halo: 'rgba(232,234,235,0.9)',
};

/** Solid grey building textures with a faint dot grain, a nod to LiDAR point clouds (registered on demand, see registerPointCloudImages). */
export const POINT_CLOUD_IMAGES = {roof: 'pc-dots-roof', wall: 'pc-dots-wall'} as const;

function dotPattern(size: number, dot: number, color: string, jitter: number, background: string): ImageData {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  // Opaque base so buildings read as solid volumes; the dots are only a light texture on top.
  g.fillStyle = background;
  g.fillRect(0, 0, size, size);
  g.fillStyle = color;
  // A few slightly offset dots per tile so the texture looks sampled rather than printed.
  const step = size / 2;
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const ox = ((x * 7 + y * 3) % 5 - 2) / 2 * jitter, oy = ((x * 3 + y * 5) % 5 - 2) / 2 * jitter;
    g.beginPath(); g.arc(step * x + step / 2 + ox, step * y + step / 2 + oy, dot, 0, Math.PI * 2); g.fill();
  }
  return g.getImageData(0, 0, size, size);
}

export function registerPointCloudImages(map: {hasImage(id: string): boolean; addImage(id: string, img: ImageData, o: {pixelRatio: number}): void; on(type: 'styleimagemissing', cb: (e: {id: string}) => void): unknown}) {
  const add = (id: string) => {
    if (map.hasImage(id)) return;
    if (id === POINT_CLOUD_IMAGES.roof) map.addImage(id, dotPattern(12, 0.8, 'rgba(55,65,73,0.18)', 1.2, '#DCE0E3'), {pixelRatio: 2});
    if (id === POINT_CLOUD_IMAGES.wall) map.addImage(id, dotPattern(10, 0.8, 'rgba(45,55,63,0.18)', 1, '#F1F3F4'), {pixelRatio: 2});
  };
  map.on('styleimagemissing', e => add(e.id));
  Object.values(POINT_CLOUD_IMAGES).forEach(add);
}

export const ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const TERRAIN_ATTRIBUTION = 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen/AWS Terrain Tiles</a>';

export const TERRAIN_SOURCE = 'terrain-dem';
const HILLSHADE_SOURCE = 'hillshade-dem';
export const TERRAIN_EXAGGERATION = 1.3;

// Layers that add colour noise without helping an operator read the route.
const DROP = /^(natural_earth|poi_|highway-shield|road_shield|airport|road_one_way|road_area_pattern|boundary_|label_country|label_state|aeroway_)/;

type Paint = Record<string, unknown>;
type Layout = Record<string, unknown>;

function restyleLayer(layer: LayerSpecification): LayerSpecification | null {
  const {id} = layer;
  if (DROP.test(id)) return null;
  const paint = {...(layer as {paint?: Paint}).paint} as Paint;
  const layout = {...(layer as {layout?: Layout}).layout} as Layout;
  const isCasing = id.includes('casing');
  const isMajor = /motorway|trunk_primary/.test(id);

  if (id === 'background') paint['background-color'] = PALETTE.land;
  else if (id === 'park') Object.assign(paint, {'fill-color': PALETTE.park, 'fill-opacity': 0.85, 'fill-outline-color': PALETTE.parkEdge});
  else if (id === 'park_outline') Object.assign(paint, {'line-color': PALETTE.parkEdge, 'line-opacity': 0.6});
  else if (id === 'landuse_residential') Object.assign(paint, {'fill-color': PALETTE.landWarm, 'fill-opacity': 0.35});
  else if (id.startsWith('landcover_') || id.startsWith('landuse_')) {
    const color = /wood|wetland/.test(id) ? PALETTE.wood : /grass|pitch|cemetery/.test(id) ? PALETTE.park : PALETTE.landWarm;
    Object.assign(paint, {'fill-color': color, 'fill-opacity': 0.6});
  }
  else if (id === 'water') paint['fill-color'] = PALETTE.water;
  else if (layer.type === 'line' && id.startsWith('waterway')) paint['line-color'] = PALETTE.water;
  else if (layer.type === 'line' && /rail/.test(id)) Object.assign(paint, {'line-color': PALETTE.rail, 'line-opacity': 0.55});
  else if (id === 'building') Object.assign(paint, {'fill-pattern': POINT_CLOUD_IMAGES.roof, 'fill-outline-color': PALETTE.buildingEdge});
  else if (id === 'building-3d') {
    delete paint['fill-extrusion-color']; // a pattern replaces the flat colour
    Object.assign(paint, {
      'fill-extrusion-pattern': POINT_CLOUD_IMAGES.wall,
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.2, 0.75], // translucent enough for the route to show through
      'fill-extrusion-vertical-gradient': true, // darker toward the ground, so walls shade like solids
    });
  }
  else if (/path_pedestrian/.test(id)) Object.assign(paint, {'line-color': isCasing ? PALETTE.casing : PALETTE.road, 'line-opacity': 0.75});
  else if (layer.type === 'line' && layer['source-layer'] === 'transportation') {
    paint['line-color'] = isCasing ? (isMajor ? PALETTE.casingMajor : PALETTE.casing) : (isMajor ? PALETTE.roadMajor : PALETTE.road);
    if (isCasing) paint['line-opacity'] = id.startsWith('road_minor') ? paint['line-opacity'] : 0.8;
    if (id.startsWith('tunnel_')) paint['line-opacity'] = 0.35;
  }
  else if (layer.type === 'symbol') {
    Object.assign(paint, {'text-color': PALETTE.label, 'text-halo-color': PALETTE.halo, 'text-halo-width': 1.2, 'text-halo-blur': 0.4});
    delete layout['icon-image'];
    if (id.startsWith('water_name') || id === 'waterway_line_label') {
      Object.assign(layout, {'text-font': ['Noto Sans Italic'], 'text-letter-spacing': 0.12,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 11, 16, 13]});
      paint['text-color'] = PALETTE.waterLabel;
    } else if (id === 'label_other' || id === 'label_village' || id === 'label_town') {
      // Neighbourhoods: small, letter-spaced uppercase, like the reference ("LIBERTY VILLAGE").
      Object.assign(layout, {'text-font': ['Noto Sans Regular'], 'text-transform': 'uppercase', 'text-letter-spacing': 0.22,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9, 16, 11]});
      paint['text-color'] = PALETTE.labelSoft;
    } else if (id.startsWith('label_city')) {
      Object.assign(layout, {'text-transform': 'uppercase', 'text-letter-spacing': 0.3});
    } else if (id.startsWith('highway-name')) {
      Object.assign(layout, {'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 17, 12], 'text-letter-spacing': 0.04});
    }
  }
  return {...layer, paint, layout} as LayerSpecification;
}

/**
 * `hillshade` tints the land from the DEM. `terrain` adds MapLibre 3D terrain; it is off by default because
 * Toronto is flat and, in MapLibre 5.6, GeoJSON lines inserted under the 3D buildings at runtime do not re-drape
 * onto terrain (the route vanishes). Enable with ?terrain=1; the route then draws above the buildings instead.
 */
export function buildMissionStyle({hillshade = true, terrain = false} = {}): StyleSpecification {
  const base = structuredClone(liberty) as unknown as StyleSpecification;
  const layers = base.layers.map(restyleLayer).filter((l): l is LayerSpecification => l !== null);

  // Darker shoreline under the water fill's edge.
  const waterIndex = layers.findIndex(l => l.id === 'water');
  layers.splice(waterIndex + 1, 0, {
    id: 'water-shore', type: 'line', source: 'openmaptiles', 'source-layer': 'water',
    paint: {'line-color': PALETTE.shore, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 17, 2.2], 'line-blur': 0.6, 'line-opacity': 0.7},
  });

  const sources: StyleSpecification['sources'] = {openmaptiles: {...base.sources.openmaptiles, attribution: ATTRIBUTION} as never};
  if (hillshade || terrain) {
    // Same DEM twice: MapLibre renders terrain and hillshade better from separate sources.
    const dem = (): RasterDEMSourceSpecification => ({type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15,
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], attribution: TERRAIN_ATTRIBUTION});
    sources[TERRAIN_SOURCE] = dem();
    sources[HILLSHADE_SOURCE] = dem();
    // Hillshade sits under water and roads so it only tints the land.
    if (hillshade) layers.splice(waterIndex, 0, {
      id: 'hillshade', type: 'hillshade', source: HILLSHADE_SOURCE,
      paint: {'hillshade-shadow-color': '#9AA3A9', 'hillshade-highlight-color': '#FFFFFF', 'hillshade-accent-color': '#B7BEC3',
        'hillshade-exaggeration': 0.2, 'hillshade-illumination-direction': 315},
    });
  }

  return {
    version: 8, name: 'Rover mission (point cloud)', glyphs: base.glyphs, sprite: base.sprite, sources, layers,
    // Softer than MapLibre's default light, so extruded walls stay pale grey instead of going dark.
    light: {anchor: 'viewport', color: '#ffffff', intensity: 0.3},
    ...(terrain ? {terrain: {source: TERRAIN_SOURCE, exaggeration: TERRAIN_EXAGGERATION}} : {}),
    // Cool haze toward the horizon so the tilted view fades out instead of ending in a hard edge.
    sky: {'sky-color': '#E4E7E9', 'horizon-color': '#ECEEEF', 'fog-color': '#E9EBEC', 'fog-ground-blend': 0.55,
      'horizon-fog-blend': 0.7, 'sky-horizon-blend': 0.65, 'atmosphere-blend': 0},
  };
}
