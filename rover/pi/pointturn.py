#!/usr/bin/env python3
"""
Point-turn (K-turn): pivot the car nearly in place by steering one way going
forward and the OTHER way going backward, so the rotation adds up.

This version gives the steering plenty of time to swing and announces each phase
so you can WATCH THE FRONT WHEELS:
  - on "wheels -> RIGHT/LEFT" the car sits still and the front wheels should
    visibly swing to that side,
  - then it drives forward / reverse.
If the front wheels do NOT swing during those phases, the steering is the
problem (not the turn logic) -- tell me what you see.

    sudo systemctl stop rc-car
    cd ~/rc-path/pi
    python3 pointturn.py                 # right, 6 cycles, 0.6s drive, 1.2s swing
    python3 pointturn.py L               # pivot left
    python3 pointturn.py R 6 0.6 1.2     # dir, cycles, drive_s, swing_s

Car ON THE FLOOR with a little space. Ctrl+C stops it.
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from motors import Drive  # noqa: E402

cfg = json.load(open(os.path.join(HERE, "car_config.json")))

direction = (sys.argv[1] if len(sys.argv) > 1 else "R").upper()
cycles = int(sys.argv[2]) if len(sys.argv) > 2 else 6
seg = float(sys.argv[3]) if len(sys.argv) > 3 else 0.6
flip = float(sys.argv[4]) if len(sys.argv) > 4 else 1.2

turn = 1.0 if direction.startswith("R") else -1.0
hz = cfg.get("control_hz", 50)
dt = 1.0 / hz


def hold(drive_cmd, steer_cmd, seconds):
    """Re-send drive + steer every tick (DC steering is pulsed, so it needs
    repeated calls to hold a position)."""
    for _ in range(max(1, int(seconds * hz))):
        d.set(drive_cmd, steer_cmd)
        time.sleep(dt)


d = Drive(cfg)
print(f"Point-turn: pivot {'RIGHT' if turn > 0 else 'LEFT'}, {cycles} cycles. "
      f"Watch the FRONT wheels on each 'wheels ->' line. Ctrl+C to stop.")
try:
    for i in range(cycles):
        print(f"[{i+1}/{cycles}] wheels -> {'RIGHT' if turn>0 else 'LEFT'} (watch front wheels)")
        hold(0.0, turn, flip)
        print("         forward")
        hold(1.0, turn, seg)
        print(f"         wheels -> {'LEFT' if turn>0 else 'RIGHT'} (watch front wheels)")
        hold(0.0, -turn, flip)
        print("         reverse")
        hold(-1.0, -turn, seg)
except KeyboardInterrupt:
    print("\nstopped")
finally:
    d.stop()
    d.close()
