"""
Motor output layer. Takes normalized commands from the planner and drives the motors.

  differential: set(left, right)     each in [-1, 1] = fraction of top wheel speed
  ackermann:    set(throttle, steer) throttle in [-1, 1], steer in [-1, 1] (+ = left)

Two hardware backends (car_config.json "motor_driver"):
  "grove_i2c": Seeed Grove I2C Motor Driver v1.3 (L298 + ATmega8, address 0x0F),
               plugged into an I2C port of the Grove Base Hat. Channels M1/M2.
  "gpio":      L298N / TB6612 wired to GPIO pins, driven with gpiozero.
Falls back to a printing mock when the hardware library isn't available or
RC_MOCK=1, so everything can be tested on a Mac.
"""
import os
import time


def _shape(x, deadband, trim):
    """Map a desired speed fraction to PWM duty: motors don't move below `deadband`."""
    if abs(x) < 0.01:
        return 0.0
    duty = deadband + (1 - deadband) * min(abs(x), 1.0)
    return max(-1.0, min(1.0, (1 if x > 0 else -1) * duty * trim))


class _Chan:
    """A motor output; `value` in [-1, 1]. Mock and Grove channels are plain holders."""
    def __init__(self, name):
        self.name, self.value = name, 0.0

    def close(self):
        pass


class GroveI2CMotorDriver:
    """Seeed Grove I2C Motor Driver v1.3 protocol (from Seeed's Arduino library)."""
    SPEED = 0x82      # [speed_m1 0-255, speed_m2 0-255]
    DIRECTION = 0xAA  # [dir, 0x01]; per motor 2 bits: 0b10 = clockwise, 0b01 = anticlockwise
    PWM_FREQ = 0x84   # [freq, 0x01]

    def __init__(self, bus=1, address=0x0F):
        try:
            from smbus2 import SMBus
        except ImportError:
            from smbus import SMBus
        self.bus, self.addr = SMBus(bus), address
        self.last = None
        self._write(self.PWM_FREQ, [0x02, 0x01])  # 3.9 kHz: quieter than 31 kHz on L298, still smooth
        self.write(0.0, 0.0)

    def _write(self, reg, data):
        for attempt in range(3):  # the ATmega8 occasionally NAKs; retry
            try:
                self.bus.write_i2c_block_data(self.addr, reg, data)
                time.sleep(0.002)  # ATmega8 needs a moment between commands
                return
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(0.005)

    def write(self, m1, m2):
        s1, s2 = int(round(abs(m1) * 255)), int(round(abs(m2) * 255))
        d = (0b01 if m1 < 0 else 0b10) | ((0b01 if m2 < 0 else 0b10) << 2)
        if (d, s1, s2) == self.last:
            return  # skip redundant I2C traffic at 50 Hz
        if not self.last or self.last[0] != d:
            self._write(self.DIRECTION, [d, 0x01])
        self._write(self.SPEED, [min(s1, 255), min(s2, 255)])
        self.last = (d, s1, s2)

    def close(self):
        try:
            self.write(0.0, 0.0)
        finally:
            self.bus.close()


class Drive:
    def __init__(self, cfg):
        self.cfg = cfg
        self.backend = cfg.get("motor_driver", "gpio")
        self.mock = os.environ.get("RC_MOCK") == "1"
        self.board = None
        diff = cfg.get("drive", "differential") == "differential"
        names = ["left", "right"] if diff else ["drive", "steer"]

        if self.backend == "grove_i2c":
            if not self.mock:
                try:
                    i2c = cfg.get("i2c", {})
                    self.board = GroveI2CMotorDriver(i2c.get("bus", 1), i2c.get("address", 0x0F))
                except ImportError:
                    self.mock = True
            self.devices = {n: _Chan(n) for n in names}
        else:
            if not self.mock:
                try:
                    import gpiozero  # noqa: F401
                except ImportError:
                    self.mock = True
            self.devices = self._gpio_devices(cfg, diff)
        self.stop()

    def _gpio_devices(self, cfg, diff):
        p = cfg["pins"]
        if diff:
            return {"left": self._gpio_motor(p["left"], "left"),
                    "right": self._gpio_motor(p["right"], "right")}
        devs = {"drive": self._gpio_motor(p["drive_motor"], "drive")}
        st = p["steering"]
        if st["type"] == "servo" and not self.mock:
            from gpiozero import Servo
            devs["steer"] = Servo(st["pin"])
        elif st["type"] == "servo":
            devs["steer"] = _Chan("steer")
        else:
            devs["steer"] = self._gpio_motor(st, "steer")
        return devs

    def _gpio_motor(self, pins, name):
        if self.mock:
            return _Chan(name)
        from gpiozero import Motor
        return Motor(forward=pins["forward"], backward=pins["backward"],
                     enable=pins.get("enable"), pwm=True)

    def flush(self):
        """Push channel values to the I2C board (GPIO devices update immediately)."""
        if self.board:
            ch = self.cfg.get("channels", {})
            vals = {"M1": 0.0, "M2": 0.0}
            for name, dev in self.devices.items():
                vals[ch.get(name, "M1" if name in ("left", "drive") else "M2")] = dev.value
            self.board.write(vals["M1"], vals["M2"])

    def set(self, a, b):
        c = self.cfg
        db = c.get("deadband", 0.25)
        if c.get("drive", "differential") == "differential":
            self.devices["left"].value = _shape(a, db, c.get("left_trim", 1.0)) * (-1 if c.get("invert_left") else 1)
            self.devices["right"].value = _shape(b, db, c.get("right_trim", 1.0)) * (-1 if c.get("invert_right") else 1)
        else:
            st = c["pins"]["steering"]
            s = -b if st.get("invert") else b
            if st["type"] == "servo":
                steer = max(-1.0, min(1.0, s + st.get("center", 0.0)))
            else:
                steer = self._pulse_steer(s, st)
            self.devices["drive"].value = _shape(a, db, 1.0) * (-1 if c.get("invert_drive") else 1)
            self.devices["steer"].value = steer
        self.flush()

    def _pulse_steer(self, s, st):
        """
        Toy-car DC steering is bang-bang (full left / straight / full right). To get gentle
        curves we pulse it (sigma-delta): steering 40% left = full-left 40% of the time,
        decided every `dc_hold_ticks` ticks so the mechanism has time to move.
        """
        hold = st.get("dc_hold_ticks", 5)
        self._acc = getattr(self, "_acc", 0.0)
        self._tick = getattr(self, "_tick", 0)
        self._steer_out = getattr(self, "_steer_out", 0)
        if self._tick % hold == 0:
            self._acc += max(-1.0, min(1.0, s))
            if self._acc >= 0.5:
                self._steer_out = 1
            elif self._acc <= -0.5:
                self._steer_out = -1
            else:
                self._steer_out = 0
            self._acc -= self._steer_out
        self._tick += 1
        return self._steer_out * st.get("dc_power", 1.0)

    def stop(self):
        for d in self.devices.values():
            d.value = 0.0  # servo 0.0 == centred
        self._acc, self._tick, self._steer_out = 0.0, 0, 0
        self.flush()

    def close(self):
        self.stop()
        for d in self.devices.values():
            d.close()
        if self.board:
            self.board.close()
