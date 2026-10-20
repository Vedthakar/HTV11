"""Simulates the cable being pulled, and a reboot after power loss. Run: python3 tests/test_unplug.py"""
import os
import sys
import time

os.environ["RC_MOCK"] = "1"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pi"))
import car_server as cs  # noqa: E402

link = {"up": True}
cs.link_iface_for = lambda ip: "usb0"
cs.link_up = lambda iface: link["up"]
MISSION = {"points_m": [[0, 0], [0, 0.3]], "speed_scale": 1, "trigger": {"mode": "unplug", "delay_s": 1}}


def wait_for(car, state, timeout=10):
    end = time.time() + timeout
    while time.time() < end:
        if car.state == state:
            return
        time.sleep(0.05)
    raise AssertionError(f"never reached {state}, stuck at {car.state}")


car = cs.Car()
car.arm(dict(MISSION, trigger=dict(MISSION["trigger"])), "10.0.0.2")
wait_for(car, "armed")
time.sleep(1)
assert car.state == "armed", "must keep waiting while the cable is plugged in"
link["up"] = False  # pull the cable
wait_for(car, "countdown", 4)
wait_for(car, "running", 4)
wait_for(car, "done", 10)
print("unplug -> countdown -> run -> done: OK")

# Power loss: arm while plugged in, the Pi dies, then boots on battery with no cable.
link["up"] = True
car.arm(dict(MISSION, trigger=dict(MISSION["trigger"])), "10.0.0.2")
wait_for(car, "armed")
car.stop_evt.set()  # "power dies"
link["up"] = False
booted = cs.Car()
booted.resume_from_disk()
wait_for(booted, "done", 15)
again = cs.Car()
again.resume_from_disk()
time.sleep(0.5)
assert again.state == "idle", "must only run once"
os.remove(cs.MISSION_PATH)
print("reboot resume runs exactly once: OK")
