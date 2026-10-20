import json
import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pi"))
import pathplan  # noqa: E402

CFG = json.load(open(os.path.join(os.path.dirname(__file__), "..", "pi", "car_config.json")))


def shape(name, r=0.6):
    if name == "circle":
        return [[r * math.sin(a / 100 * 2 * math.pi), r * math.cos(a / 100 * 2 * math.pi)] for a in range(101)]
    if name == "eight":
        return [[1.3 * r * math.sin(a / 200 * 2 * math.pi), 0.9 * r * math.sin(2 * a / 200 * 2 * math.pi)] for a in range(201)]
    if name == "square":
        c = [(-r, -r), (r, -r), (r, r), (-r, r), (-r, -r)]
        return [[c[i][0] + (c[i + 1][0] - c[i][0]) * t / 20, c[i][1] + (c[i + 1][1] - c[i][1]) * t / 20]
                for i in range(4) for t in range(20)] + [list(c[0])]
    if name == "line":
        return [[0, 0], [0, 1.5]]


def check(drive, name, max_err, r=0.6):
    cfg = dict(CFG, drive=drive)
    p = pathplan.plan(shape(name, r), cfg, 0.6)
    assert p["commands"][-1] == [0.0, 0.0]
    assert all(abs(a) <= 1.0001 and abs(b) <= 1.0001 for a, b in p["commands"])
    print(f"{drive:12s} {name:7s} len={p['length_m']:.2f}m t={p['duration_s']:.1f}s "
          f"err={p['max_sim_error_m'] * 100:.1f}cm warn={len(p['warnings'])}")
    assert p["max_sim_error_m"] < max_err, p["max_sim_error_m"]
    return p


def test_all():
    for name in ("line", "circle", "eight", "square"):
        check("differential", name, 0.03)
    for name in ("line", "circle"):
        check("ackermann", name, 0.05)
    check("ackermann", "eight", 0.05, r=2.0)
    # turns tighter than the steering allows: must warn, not crash
    assert check("ackermann", "eight", 5.0)["warnings"]
    assert check("ackermann", "square", 5.0)["warnings"]


def test_circle_closes():
    p = pathplan.plan(shape("circle"), CFG, 0.6)
    assert math.dist(p["sim"][0], p["sim"][-1]) < 0.03


if __name__ == "__main__":
    test_all()
    test_circle_closes()
    print("OK")
