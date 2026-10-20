#!/usr/bin/env python3
"""
Find out what each Grove channel really does. Drives M1 and M2 directly (bypasses
the drive/steer config), one at a time, so you can see which channel is the rear
drive motor and which is the front steering -- and which direction each goes.

    sudo systemctl stop rc-car
    cd ~/rover/pi
    python3 channelcheck.py

Run it with the WHEELS OFF THE GROUND. Watch each step and note:
  - does the REAR drive motor spin, or do the FRONT wheels steer?
  - which way (forward/back, or left/right)?
Each step runs 2 s, then pauses 1 s. Ctrl+C stops it.
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from motors import GroveI2CMotorDriver  # noqa: E402

P = 0.8
STEPS = [
    ("M1 positive  (+0.8, 0)", P, 0.0),
    ("M1 negative  (-0.8, 0)", -P, 0.0),
    ("M2 positive  (0, +0.8)", 0.0, P),
    ("M2 negative  (0, -0.8)", 0.0, -P),
]

board = GroveI2CMotorDriver(1, 0x0F)
try:
    for name, m1, m2 in STEPS:
        print(f">>> {name}  -- what moves?")
        board.write(m1, m2)
        time.sleep(2.0)
        board.write(0.0, 0.0)
        time.sleep(1.0)
    print("done")
except KeyboardInterrupt:
    print("\nstopped")
finally:
    board.write(0.0, 0.0)
    board.close()
