"""Join latest apartment evaluations to footprints only when the coordinate is unambiguous.
No nearest-building guesses. Unmatched records remain visible as location markers.
"""
import csv
import json
import math
import sys
from pathlib import Path
from collections import defaultdict


def number(value, minimum, maximum):
    try:
        result = float(value)
        return result if math.isfinite(result) and minimum <= result <= maximum else None
    except (ValueError, TypeError):
        return None


def latest_records(rows):
    latest = {}
    for row in rows:
        key = row.get('RSN', '').strip() or row.get('SITE ADDRESS', '').strip().upper()
        if not key:
            continue
        rank = (row.get('EVALUATION COMPLETED ON', ''), int(row.get('_id') or 0))
        if key not in latest or rank > latest[key][0]:
            latest[key] = (rank, row)
    return [row for _, row in latest.values()]


def inside_ring(point, ring):
    x, y = point
    inside = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0]) * (y-a[1]) / (b[1]-a[1]) + a[0]:
            inside = not inside
    return inside


def contains(point, geometry):
    return any(inside_ring(point, polygon[0]) and not any(inside_ring(point, hole) for hole in polygon[1:])
               for polygon in geometry['coordinates'])


def generate(csv_path):
    root = Path(__file__).resolve().parents[1] / 'web/public/city'
    manifest = json.loads((root / 'manifest.json').read_text())
    with open(csv_path, encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))
    latest = latest_records(rows)
    grouped = defaultdict(list)
    records = []
    for row in latest:
        record = {'id': row.get('RSN') or row['SITE ADDRESS'], 'address': row['SITE ADDRESS'],
                  'date': row['EVALUATION COMPLETED ON'], 'score': number(row['CURRENT BUILDING EVAL SCORE'], 0, 100),
                  'proactiveScore': number(row.get('PROACTIVE BUILDING SCORE'), 0, 100),
                  'ward': row.get('WARDNAME'), 'storeys': row.get('CONFIRMED STOREYS'),
                  'units': row.get('CONFIRMED UNITS'),
                  'latitude': number(row.get('LATITUDE'), 43, 45),
                  'longitude': number(row.get('LONGITUDE'), -81, -78),
                  'buildingId': None, 'match': 'no location'}
        records.append(record)
        if record['latitude'] is not None and record['longitude'] is not None:
            step = manifest['tileStep']
            key = f"{math.floor(record['longitude']/step)}_{math.floor(record['latitude']/step)}"
            grouped[key].append(record)
    for key, group in grouped.items():
        path = root / 'tiles' / f'{key}.geojson'
        features = json.loads(path.read_text())['features'] if path.exists() else []
        for record in group:
            point = (record['longitude'], record['latitude'])
            candidates = {feature['id'] for feature in features if contains(point, feature['geometry'])}
            if len(candidates) == 1:
                record['buildingId'] = next(iter(candidates))
                record['match'] = 'coordinate inside footprint'
            else:
                record['match'] = 'ambiguous footprints' if candidates else 'no containing footprint'
    stats = {'sourceRows': len(rows), 'latestRecords': len(records),
             'located': sum(r['latitude'] is not None and r['longitude'] is not None for r in records),
             'matched': sum(r['buildingId'] is not None for r in records),
             'scored': sum(r['score'] is not None for r in records)}
    output = {'source': 'City of Toronto — Apartment Building Evaluations 2023 - current',
              'sourceUrl': 'https://open.toronto.ca/dataset/apartment-building-evaluation/',
              'scoreField': 'CURRENT BUILDING EVAL SCORE', 'stats': stats, 'records': records,
              'method': 'Latest completed evaluation per RSN; unambiguous coordinate-in-footprint match only. Spatial association is not address verified.'}
    (root / 'evaluations.json').write_text(json.dumps(output, separators=(',', ':')))
    print(json.dumps(stats, indent=2))

if __name__ == '__main__':
    generate(sys.argv[1])
