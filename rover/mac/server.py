#!/usr/bin/env python3
"""
Local web UI for drawing paths.   python3 server.py   ->  http://localhost:8000

  /api/plan    plan a path locally for the preview (uses the Pi's config if reachable)
  /api/upload  send the path to the Pi, which re-plans with its own config and arms it
  /api/status  proxy the Pi's /status
  /api/stop    proxy the Pi's /stop
No dependencies beyond the Python standard library.
"""
import json
import os
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pi"))
import pathplan  # noqa: E402  (shared with the Pi so the preview matches)

LOCAL_CONFIG = os.path.join(HERE, "..", "pi", "car_config.json")
PORT = int(os.environ.get("PORT", "8000"))


def pi_request(pi, path, body=None, timeout=4):
    url = f"http://{pi}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")
    except Exception as e:
        return 502, {"error": f"Can't reach the Pi at {pi}: {e}"}


def get_config(pi):
    code, cfg = pi_request(pi, "/config", timeout=1.5)
    if code == 200:
        return cfg, "pi"
    with open(LOCAL_CONFIG) as f:
        return json.load(f), "local"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=os.path.join(HERE, "static"), **kw)

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        pi = body.get("pi", "raspberrypi.local:8080")
        if self.path == "/api/plan":
            cfg, src = get_config(pi)
            try:
                res = pathplan.plan(body["points_m"], cfg, body.get("speed_scale", 1.0))
            except ValueError as e:
                return self._json(400, {"error": str(e)})
            res.pop("commands")
            res["config_source"] = src
            res["drive_type"] = cfg.get("drive")
            res["track_width_m"] = cfg.get("track_width_m")
            self._json(200, res)
        elif self.path == "/api/upload":
            mission = {k: body[k] for k in ("points_m", "speed_scale", "trigger")}
            self._json(*pi_request(pi, "/mission", mission, timeout=15))
        elif self.path == "/api/status":
            self._json(*pi_request(pi, "/status", timeout=2))
        elif self.path == "/api/stop":
            self._json(*pi_request(pi, "/stop", {}))
        else:
            self._json(404, {"error": "not found"})

    def log_message(self, fmt, *args):
        if not (args and "/api/status" in str(args[0])):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    print(f"Open http://localhost:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
