#!/usr/bin/env python3
"""
Runs on the Raspberry Pi (as a systemd service, see rc-car.service).

  POST /mission  {"points_m": [[x,y],...], "speed_scale": 0.6,
                  "trigger": {"mode": "unplug"|"delay"|"now", "delay_s": 5}}
  POST /stop     emergency stop + disarm
  GET  /status   state, mission summary
  GET  /config   car_config.json

Mission lifecycle:  idle -> armed -> countdown -> running -> done
"unplug" trigger: we find which network interface the Mac talked to us over
(usb0 for USB gadget mode, eth0 for a cable). When that link goes down, we
count down `delay_s` seconds (time to put the car on the floor) and drive.
The armed mission is saved to disk, so if pulling the cable also cut the Pi's
power, it resumes on the next boot (battery power) and runs once.
"""
import json
import os
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pathplan  # noqa: E402
from motors import Drive  # noqa: E402

CONFIG_PATH = os.path.join(HERE, "car_config.json")
MISSION_PATH = os.path.join(HERE, "mission.json")
PORT = int(os.environ.get("RC_PORT", "8080"))


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


def link_iface_for(ip):
    """Which local interface routes to `ip` (e.g. usb0, eth0, wlan0)."""
    try:
        out = subprocess.run(["ip", "route", "get", ip], capture_output=True, text=True, timeout=2).stdout
        parts = out.split()
        return parts[parts.index("dev") + 1]
    except Exception:
        return None


def link_up(iface):
    try:
        with open(f"/sys/class/net/{iface}/carrier") as f:
            return f.read().strip() == "1"
    except OSError:
        return False  # interface vanished (USB gadget unplugged) == down


class Car:
    def __init__(self):
        self.cfg = load_config()
        self.drive = Drive(self.cfg)
        self.state = "idle"
        self.detail = ""
        self.mission = None
        self.stop_evt = threading.Event()
        self.lock = threading.Lock()
        self.worker = None

    # ---- mission management -------------------------------------------------
    def arm(self, body, client_ip):
        self.cancel()
        self.cfg = load_config()
        result = pathplan.plan(body["points_m"], self.cfg, body.get("speed_scale", 1.0))
        trig = body.get("trigger", {"mode": "unplug"})
        trig.setdefault("delay_s", self.cfg.get("start_delay_s", 5))
        iface = link_iface_for(client_ip) if trig["mode"] == "unplug" else None
        if trig["mode"] == "unplug" and (not iface or iface.startswith(("wlan", "lo"))):
            result["warnings"].append(
                f"Connected over {iface or 'unknown'}: can't detect an unplug on that link, "
                f"so the car will start {trig['delay_s']}s after upload instead.")
            trig["mode"] = "delay"
        trig["iface"] = iface
        self.mission = {"plan": result, "trigger": trig, "armed": True, "uploaded": time.time()}
        self._save()
        self._start_worker()
        summary = {k: v for k, v in result.items() if k not in ("commands",)}
        summary["trigger"] = trig
        return summary

    def resume_from_disk(self):
        try:
            with open(MISSION_PATH) as f:
                m = json.load(f)
        except (OSError, ValueError):
            return
        if m.get("armed"):
            log("Resuming armed mission from disk (booted after unplug?)")
            self.mission = m
            self._start_worker()

    def cancel(self):
        self.stop_evt.set()
        if self.worker and self.worker.is_alive():
            self.worker.join(timeout=2)
        self.stop_evt.clear()
        self.drive.stop()

    def estop(self):
        self.cancel()
        if self.mission:
            self.mission["armed"] = False
            self._save()
        self._set("idle", "stopped by user")

    def _save(self):
        tmp = MISSION_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.mission, f)
        os.replace(tmp, MISSION_PATH)

    def _set(self, state, detail=""):
        self.state, self.detail = state, detail
        log("state:", state, detail)

    def _start_worker(self):
        self.worker = threading.Thread(target=self._lifecycle, daemon=True)
        self.worker.start()

    # ---- lifecycle thread ---------------------------------------------------
    def _lifecycle(self):
        trig = self.mission["trigger"]
        if trig["mode"] == "unplug":
            iface = trig.get("iface")
            self._set("armed", f"waiting for {iface} cable to be unplugged")
            down_since = None
            while not self.stop_evt.is_set():
                if link_up(iface):
                    down_since = None
                elif down_since is None:
                    down_since = time.monotonic()
                elif time.monotonic() - down_since > 1.5:  # debounce
                    break
                time.sleep(0.2)
        if self.stop_evt.is_set():
            return
        if trig["mode"] != "now":
            end = time.monotonic() + float(trig.get("delay_s", 5))
            while time.monotonic() < end:
                self._set("countdown", f"{end - time.monotonic():.0f}s")
                if self.stop_evt.wait(1.0):
                    return
        # Run once: disarm *before* driving so a crash/reboot never re-runs it.
        self.mission["armed"] = False
        self._save()
        self._run(self.mission["plan"])

    def _run(self, plan):
        cmds, dt = plan["commands"], plan["dt"]
        max_run = self.cfg.get("max_run_s", 120)
        self._set("running", f"{len(cmds)} steps, {plan['duration_s']}s")
        t0 = time.monotonic()
        try:
            for i, (a, b) in enumerate(cmds):
                if self.stop_evt.is_set() or time.monotonic() - t0 > max_run:
                    break
                self.drive.set(a, b)
                # absolute scheduling so timing errors don't accumulate
                delay = t0 + (i + 1) * dt - time.monotonic()
                if delay > 0:
                    self.stop_evt.wait(delay)
        finally:
            self.drive.stop()
        self._set("done" if not self.stop_evt.is_set() else "idle",
                  f"ran {time.monotonic() - t0:.1f}s")

    def status(self):
        s = {"state": self.state, "detail": self.detail, "config_drive": self.cfg.get("drive"),
             "mock_motors": self.drive.mock}
        if self.mission:
            p = self.mission["plan"]
            s["mission"] = {"length_m": p["length_m"], "duration_s": p["duration_s"],
                            "trigger": self.mission["trigger"], "armed": self.mission["armed"]}
        return s


CAR = None


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/status":
            self._send(200, CAR.status())
        elif self.path == "/config":
            self._send(200, load_config())
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/mission":
                self._send(200, CAR.arm(body, self.client_address[0]))
            elif self.path == "/stop":
                CAR.estop()
                self._send(200, {"ok": True})
            else:
                self._send(404, {"error": "not found"})
        except Exception as e:  # report planning errors to the UI
            log("error:", repr(e))
            self._send(400, {"error": str(e)})

    def log_message(self, fmt, *args):
        pass


def main():
    global CAR
    CAR = Car()
    log(f"RC car server on :{PORT} (motors: {'MOCK' if CAR.drive.mock else 'GPIO'})")

    def shutdown(*_):
        CAR.cancel()
        CAR.drive.close()
        os._exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    CAR.resume_from_disk()
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
