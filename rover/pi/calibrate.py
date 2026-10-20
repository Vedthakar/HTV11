#!/usr/bin/env python3
"""
Calibrate the numbers that make open-loop driving accurate.
Stop the service first:  sudo systemctl stop rc-car

  python3 calibrate.py straight   # drive forward 2 s at full power -> max_speed_mps
  python3 calibrate.py spin       # spin in place 3 s at full power -> track_width_m (differential)
  python3 calibrate.py deadband   # ramp power up slowly -> deadband
  python3 calibrate.py wiggle     # short pulse on each motor to check wiring/direction
  python3 calibrate.py circle     # (steering car) full-lock circle -> max_steer_deg
  python3 calibrate.py i2c        # check the Grove I2C motor driver answers at 0x0F
"""
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from motors import Drive  # noqa: E402

CONFIG_PATH = os.path.join(HERE, "car_config.json")


def save(cfg, key, val):
    cfg[key] = round(val, 4)
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
    print(f"saved {key} = {cfg[key]}")


def raw(d, a, b, secs):
    """Bypass deadband shaping: full-scale commands."""
    d.set(a, b)
    time.sleep(secs)
    d.stop()


def main():
    cfg = json.load(open(CONFIG_PATH))
    mode = sys.argv[1] if len(sys.argv) > 1 else "wiggle"
    d = Drive(cfg)
    diff = cfg.get("drive", "differential") == "differential"
    try:
        if mode == "wiggle":
            if diff:
                print("LEFT wheels forward..."); raw(d, 0.5, 0, 1); time.sleep(0.5)
                print("RIGHT wheels forward..."); raw(d, 0, 0.5, 1)
                print("If a side spun backwards, set invert_left / invert_right in car_config.json")
            else:
                print("Drive forward..."); raw(d, 0.5, 0, 1); time.sleep(0.5)
                print("Steer LEFT..."); raw(d, 0, 1, 1); time.sleep(0.5)
                print("Steer RIGHT..."); raw(d, 0, -1, 1)
                print("If directions are wrong, set invert_drive / steering.invert")
        elif mode == "straight":
            input("Put the car on the floor with room ahead (>2 m). Enter to go...")
            raw(d, 1.0, 1.0 if diff else 0.0, 2.0)
            dist = float(input("Distance travelled in cm: "))
            save(cfg, "max_speed_mps", dist / 100 / 2.0)
            if diff:
                print("If it curved, lower the trim of the faster side (left_trim/right_trim, e.g. 0.95).")
        elif mode == "spin" and diff:
            input("Car on the floor, mark its heading. Enter to spin for 3 s...")
            raw(d, -1.0, 1.0, 3.0)
            turns = float(input("How many full turns did it make (e.g. 2.25)? "))
            # omega = 2 vmax / W  ->  W = 2 vmax t / (2 pi turns)
            save(cfg, "track_width_m", 2 * cfg["max_speed_mps"] * 3.0 / (2 * math.pi * turns))
        elif mode == "deadband":
            print("Ramping power on the floor. Press Ctrl+C the moment the car starts moving.")
            p = 0.0
            try:
                while p <= 1.0:
                    for dev in (d.devices.get("left"), d.devices.get("right"), d.devices.get("drive")):
                        if dev:
                            dev.value = p
                    d.flush()
                    print(f"\rpower {p:.2f}", end="", flush=True)
                    time.sleep(0.3)
                    p += 0.02
            except KeyboardInterrupt:
                d.stop()
                print()
                save(cfg, "deadband", max(0.0, p - 0.02))
        elif mode == "circle" and not diff:
            input("Car on the floor with ~2 m of space. Enter to drive a full-left circle for 4 s...")
            d.set(0.5, 1.0)
            time.sleep(4.0)
            d.stop()
            diam = float(input("Diameter of the circle it drove, in cm: "))
            # bicycle model: radius = wheelbase / tan(steer)
            save(cfg, "max_steer_deg", math.degrees(math.atan(cfg["wheelbase_m"] / (diam / 200))))
        elif mode == "i2c":
            print("Driver found and initialised OK" if d.board else
                  "Running in MOCK mode: is smbus2 installed and motor_driver = grove_i2c?")
        else:
            print(__doc__)
    finally:
        d.close()


if __name__ == "__main__":
    main()
