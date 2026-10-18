"""Prepare static geographic GeoJSON tiles. Run from the project root with a source path."""
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from prepare_city import normalize

STEP = .01

def tile_keys(bounds):
    west, south, east, north = bounds
    return [(x, y) for x in range(math.floor(west / STEP), math.floor(east / STEP) + 1)
            for y in range(math.floor(south / STEP), math.floor(north / STEP) + 1)]

def generate(path):
    with Path(path).open() as f:
        source = json.load(f)
    tiles = defaultdict(list)
    bounds = [180, 90, -180, -90]
    count = 0
    for raw in source['features']:
        feature = normalize(raw, bounds=None)
        if feature is None:
            continue
        points = [p for polygon in feature['geometry']['coordinates'] for ring in polygon for p in ring]
        b = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]
        bounds = [min(bounds[0], b[0]), min(bounds[1], b[1]), max(bounds[2], b[2]), max(bounds[3], b[3])]
        for x, y in tile_keys(b):
            tiles[f'{x}_{y}'].append(feature)
        count += 1
    out = Path(__file__).resolve().parents[1] / 'web/public/city'
    directory = out / 'tiles'
    directory.mkdir(parents=True, exist_ok=True)
    # Only replace generated tiles, never source data.
    for key, features in tiles.items():
        (directory / f'{key}.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': features}, separators=(',', ':')))
    manifest = {'version': 2, 'name': 'Toronto', 'bounds': bounds, 'count': count, 'tileStep': STEP,
                'tiles': {key: len(value) for key, value in tiles.items()},
                'source': 'City of Toronto — Topographic Mapping / Building Outlines',
                'sourceUrl': 'https://open.toronto.ca/dataset/topographic-mapping-building-outlines/',
                'license': 'Contains information licensed under the Open Government Licence – Toronto.',
                'note': 'Simplified footprint extrusions. Derived heights are displayed as metres and are not survey verified. Missing/invalid heights use a labelled 6 m display fallback. Flat ground; elevation is not applied.'}
    (out / 'manifest.json').write_text(json.dumps(manifest, separators=(',', ':')))
    print(f'Prepared {count:,} features in {len(tiles):,} tiles.')

if __name__ == '__main__':
    generate(sys.argv[1])
