"""Watch a synced folder (e.g. iCloud Drive) and import new LOTA ZIPs into the running backend.

Usage: npm run watch -- "C:\\Users\\you\\iCloudDrive\\LOTA" [--server http://127.0.0.1:8008]
Set HTV_CAPTURE_TOKEN if the backend requires a token. Imported files are remembered in
data/lota_watch.json so restarts do not import twice.
"""
from pathlib import Path
import argparse, json, os, sys, time
import httpx

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / 'data' / 'lota_watch.json'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('folder', type=Path)
    parser.add_argument('--server', default='http://127.0.0.1:8008')
    parser.add_argument('--interval', type=float, default=5)
    args = parser.parse_args()
    if not args.folder.is_dir():
        sys.exit(f'Folder not found: {args.folder}')
    done = set(json.loads(STATE.read_text())) if STATE.exists() else set()
    sizes = {}
    headers = {'X-Capture-Token': os.environ.get('HTV_CAPTURE_TOKEN', '')}
    print(f'Watching {args.folder} for LOTA_*.zip (Ctrl+C to stop)')
    while True:
        for f in sorted(args.folder.glob('LOTA_*.zip')):
            key = f'{f.name}:{f.stat().st_size}:{int(f.stat().st_mtime)}'
            if key in done:
                continue
            # Only import once the size is unchanged across two polls (sync finished).
            if sizes.get(f) != f.stat().st_size:
                sizes[f] = f.stat().st_size
                continue
            print('Importing', f.name, '...', end=' ', flush=True)
            try:
                with f.open('rb') as body:
                    r = httpx.post(f'{args.server}/api/sessions/import', content=body, timeout=None,
                                   headers={**headers, 'X-Filename': f.name})
                r.raise_for_status()
                print('queued as session', r.json()['id'])
                done.add(key); STATE.write_text(json.dumps(sorted(done)))
            except httpx.HTTPError as e:
                detail = getattr(getattr(e, 'response', None), 'text', '') or str(e)
                print('failed:', detail)
        time.sleep(args.interval)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
