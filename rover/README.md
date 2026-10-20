# RC Path: draw a path on your Mac, the car drives it

```
 Mac (browser) ──draw──> mac/server.py ──HTTP──> Pi: car_server.py ──GPIO──> motor driver ──> motors
   localhost:8000          (plans preview)         (plans + stores mission,
                                                    waits for unplug, drives)
```

## How the math works (pi/pathplan.py)
1. **Resample** your mouse stroke every 1 cm and **smooth** it (Gaussian, ~3 cm) to remove hand jitter.
2. Compute **heading θ(s)** and **curvature κ(s) = dθ/ds** along the path.
3. **Velocity profile**: cruise speed, slowed in tight curves (lateral-accel limit, and for tank-drive the
   outer wheel must not exceed 100%), with acceleration limits; it starts and ends at rest.
4. **Time-parameterize** and sample at 50 Hz. Each 20 ms tick, the command is the exact change in distance (Δs)
   and heading (Δθ) for that tick:
   - **Differential / tank drive:** `v = Δs/dt`, `ω = Δθ/dt`, `left = v − ω·W/2`, `right = v + ω·W/2`
   - **Ackermann (steering front wheels):** `steer = atan(L·κ)`. Curves tighter than the car's minimum turning
     radius are flagged in the UI.
5. The plan is **forward-simulated** and drawn in orange so you can see what the car will do before uploading.

This is *open-loop* (dead reckoning), the same idea as the trajectory part of PythonRobotics / ROS Nav2.
Accuracy depends on calibration and floor grip. Expect a few cm of error per metre. A gyro (MPU-6050) or
wheel encoders would let it correct itself (see "Next steps").

## 1. Connect the Pi to the Mac
Pick one; the car detects the unplug on any of these:
- **USB data cable (Pi Zero 2 W / Pi 4 / Pi 5 "USB gadget" mode):** shows up as `usb0`. Address: `raspberrypi.local:8080`.
- **Ethernet cable** (Mac USB-Ethernet adapter): shows up as `eth0`.
- **Wi-Fi only:** works, but no cable to unplug, so it uses the countdown trigger instead.

⚠️ **Power:** if the Mac's USB cable is also powering the Pi, unplugging cuts its power. Give the car a battery
(USB power bank or 5 V BEC) that's connected *before* you unplug. If the Pi does lose power, the mission is saved:
plug the battery in, the Pi boots, waits `start_delay_s`, and drives once.

## 2. Install on the Pi
```bash
# from the Mac (adjust user/hostname):
scp -r rover pi@raspberrypi.local:~/
ssh pi@raspberrypi.local
cd ~/rover/pi && bash install.sh       # installs gpiozero, sets up the auto-start service
journalctl -u rc-car -f                  # watch logs
```

## 3. Wire it (open wiring.html for the numbered diagram)
Current setup: Grove I2C Motor Driver v1.3 on a Base Hat I2C port, everything powered by one USB power bank.
- Pull the driver's J4 jumper off. Cut the Grove cable's red wire 5 cm from the driver plug: tape the Pi-side end,
  put the driver-side end into the driver's + screw together with +5 V from the power bank. Ground to −.
- Drive motor → M1, steering motor → M2.
- The original RC board's 3.7 V lithium cell is too low for this driver (needs 6 V+ on its battery input). Don't use it.

### GPIO wiring (only if you switch to an L298N/TB6612 board, `"motor_driver": "gpio"`)
Default (BCM numbering, L298N or TB6612FNG driver):

| Signal | Left motor | Right motor |
|---|---|---|
| IN1 (forward) | GPIO17 | GPIO23 |
| IN2 (backward) | GPIO27 | GPIO24 |
| EN / PWM | GPIO12 | GPIO13 |

Set `"drive"` to `"differential"` (2 independently driven sides) or `"ackermann"` (drive motor + steering).
For Ackermann, steering can be a `servo` (signal on GPIO18) or a toy-car `dc` steering motor.
**Always connect motor-driver GND to Pi GND.**

## 4. Calibrate (important for accuracy)
```bash
sudo systemctl stop rc-car
cd ~/rover/pi
python3 calibrate.py wiggle     # check each motor turns the right way (fix with invert_* flags)
python3 calibrate.py deadband   # minimum power at which the car moves
python3 calibrate.py straight   # measures max_speed_mps; tune left_trim/right_trim if it curves
python3 calibrate.py spin       # (tank drive) measures effective track_width_m
sudo systemctl start rc-car
```

## 5. Run the UI on the Mac
```bash
cd rover/mac && python3 server.py      # no pip installs needed
```
Open **http://localhost:8000**:
1. Set the floor-area width and draw your path (or click Circle / Figure 8 / Square).
2. Check the preview (orange = simulated car, green marker = where to put the car and which way it faces).
3. Pick the trigger ("When I unplug the cable"), then **Upload to car**.
4. Unplug, set the car on the green marker facing the arrow, step back. It drives after the delay.

The **Stop / disarm** button works whenever the Pi is reachable (e.g. over Wi-Fi). Also: `curl -X POST raspberrypi.local:8080/stop`.

## Tests (run anywhere, no Pi needed)
```bash
python3 tests/test_planner.py   # plans circle / figure-8 / square / line for both car types, checks accuracy
python3 tests/test_unplug.py    # simulates pulling the cable and a power-loss reboot
RC_MOCK=1 python3 pi/car_server.py   # run the Pi server on the Mac with fake motors
```

## Next steps
- **MPU-6050 gyro (~$3):** closed-loop heading correction is the biggest accuracy upgrade (keeps circles round).
- **Wheel encoders:** real odometry, so you can switch to pure-pursuit path tracking.
- **Physical start button** on a GPIO pin as a third trigger.
