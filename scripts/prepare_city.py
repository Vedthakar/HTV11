"""Extract a lightweight downtown preview from Toronto's building outlines.
Usage: python3 scripts/prepare_city.py '/path/to/Building Outlines - 4326.geojson'
"""
import json
import math
import sys
from pathlib import Path

BOUNDS = [-79.415, 43.635, -79.355, 43.68]

def normalize(feature, bounds=BOUNDS):
    geometry = feature.get('geometry') or {}
    if geometry.get('type') != 'MultiPolygon':
        return None
    rings = [ring for polygon in geometry['coordinates'] for ring in polygon]
    points = [p for ring in rings for p in ring]
    if not points:
        return None
    west, south, east, north = bounds or [-180, -90, 180, 90]
    if max(p[0] for p in points) < west or min(p[0] for p in points) > east or max(p[1] for p in points) < south or min(p[1] for p in points) > north:
        return None
    p = feature.get('properties') or {}
    try:
        height = float(p.get('DERIVED_HEIGHT'))
    except (ValueError, TypeError):
        height = float('nan')
    measured = math.isfinite(height) and 0 < height <= 650
    return {'type': 'Feature', 'id': int(p['OBJECTID']), 'properties': {
        'objectId': int(p['OBJECTID']), 'height': round(height, 2) if measured else 6,
        'heightSource': 'derived' if measured else 'display fallback',
        'sourceHeight': p.get('DERIVED_HEIGHT'), 'elevation': p.get('ELEVATION'),
        'updated': p.get('LAST_GEOMETRY_MAINT') or '', 'condition': 'unknown',
    }, 'geometry': {'type': 'MultiPolygon', 'coordinates': [
        [[[round(v, 6) for v in point[:2]] for point in ring] for ring in polygon]
        for polygon in geometry['coordinates']]}}

if __name__ == '__main__':
    path = Path(sys.argv[1])
    with path.open() as f:
        source = json.load(f)
    features = [result for feature in source['features'] if (result := normalize(feature))]
    out = Path(__file__).resolve().parents[1] / 'web/public/city'
    out.mkdir(parents=True, exist_ok=True)
    data = {'type': 'FeatureCollection', 'features': features}
    (out / 'downtown.geojson').write_text(json.dumps(data, separators=(',', ':')))
    manifest = {'name': 'Downtown Toronto', 'bounds': BOUNDS, 'count': len(features),
                'sourceCount': len(source['features']), 'source': 'City of Toronto — Topographic Mapping / Building Outlines',
                'sourceUrl': 'https://open.toronto.ca/dataset/topographic-mapping-building-outlines/',
                'license': 'Contains information licensed under the Open Government Licence – Toronto.',
                'note': 'Simplified footprint extrusions. Derived heights are displayed as metres and are not survey verified. Missing/invalid heights use a labelled 6 m display fallback. Flat ground; elevation is not applied.'}
    (out / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    print(f"Prepared {len(features):,} buildings; {(out / 'downtown.geojson').stat().st_size / 1e6:.1f} MB")
