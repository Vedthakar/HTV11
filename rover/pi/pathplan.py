"""
Path planner: turns a hand-drawn path into a timed list of motor commands.

Pipeline (same idea used by PythonRobotics / ROS Nav2 "regulated pure pursuit"):
  1. resample the drawn points at a fixed spacing (ds)
  2. smooth them (Gaussian) to remove mouse jitter
  3. compute heading theta(s) and curvature kappa(s) = d(theta)/ds
  4. build a velocity profile v(s): slow down in tight curves
     (lateral-accel + wheel-speed limits), then forward/backward passes
     for acceleration limits, starting and ending at rest
  5. time-parameterize and sample at the control rate
  6. convert (v, omega = v * kappa) into motor commands using the car's
     kinematic model:
        differential drive:  v_left  = v - omega * W / 2
                             v_right = v + omega * W / 2
        ackermann (bicycle): steer   = atan(L * kappa)
  7. forward-simulate the commands to show what the car will actually do

Pure Python (no numpy) so it runs unchanged on the Pi and on the Mac.
"""
import bisect
import math

DS = 0.01  # resample spacing, metres


def _resample(pts, ds):
    """Resample a polyline to points evenly spaced `ds` apart along its length."""
    clean = [pts[0]]
    for p in pts[1:]:
        if math.dist(p, clean[-1]) > 1e-6:
            clean.append(p)
    if len(clean) < 2:
        return clean
    seg = [math.dist(clean[i], clean[i + 1]) for i in range(len(clean) - 1)]
    total = sum(seg)
    n = max(2, int(total / ds) + 1)
    out, i, acc = [], 0, 0.0
    for k in range(n):
        target = total * k / (n - 1)
        while i < len(seg) - 1 and acc + seg[i] < target:
            acc += seg[i]
            i += 1
        f = 0.0 if seg[i] == 0 else min(1.0, (target - acc) / seg[i])
        (x0, y0), (x1, y1) = clean[i], clean[i + 1]
        out.append((x0 + f * (x1 - x0), y0 + f * (y1 - y0)))
    return out


def _gauss_smooth(vals, sigma, closed=False):
    """1-D Gaussian smoothing; endpoints are held (open) or wrapped (closed)."""
    if sigma <= 0 or len(vals) < 3:
        return list(vals)
    r = int(3 * sigma)
    w = [math.exp(-0.5 * (k / sigma) ** 2) for k in range(-r, r + 1)]
    n = len(vals)
    out = []
    for i in range(n):
        s = ws = 0.0
        for k in range(-r, r + 1):
            j = i + k
            if closed:
                j %= n - 1  # last point duplicates the first
            else:
                j = min(max(j, 0), n - 1)
            s += w[k + r] * vals[j]
            ws += w[k + r]
        out.append(s / ws)
    if not closed:
        out[0], out[-1] = vals[0], vals[-1]
    return out


def _unwrap(angles):
    out = [angles[0]]
    for a in angles[1:]:
        d = a - out[-1]
        d = (d + math.pi) % (2 * math.pi) - math.pi
        out.append(out[-1] + d)
    return out


def _dist_to_polyline(q, pts):
    best = float("inf")
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy
        f = 0.0 if L2 == 0 else max(0.0, min(1.0, ((q[0] - x0) * dx + (q[1] - y0) * dy) / L2))
        best = min(best, math.hypot(q[0] - x0 - f * dx, q[1] - y0 - f * dy))
    return best


def plan(points, cfg, speed_scale=1.0):
    """
    points: [[x, y], ...] in metres (x right, y forward/up on screen).
    cfg:    car_config.json contents.
    Returns a dict with the motor command stream plus preview data.
    """
    warnings = []
    if len(points) < 2:
        raise ValueError("Path needs at least 2 points")

    pts = _resample([tuple(p) for p in points], DS)
    if len(pts) < 5:
        raise ValueError("Path is too short (draw something longer)")
    closed = math.dist(pts[0], pts[-1]) < 0.05

    # Smooth out hand jitter (sigma in samples; ~3 cm).
    sigma = cfg.get("smoothing_m", 0.03) / DS
    xs = _gauss_smooth([p[0] for p in pts], sigma, closed)
    ys = _gauss_smooth([p[1] for p in pts], sigma, closed)
    pts = _resample(list(zip(xs, ys)), DS)
    n = len(pts)

    # Heading and curvature along the path. hd[i] = direction of segment i -> i+1.
    hd = [math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]) for i in range(n - 1)]
    hd.append(hd[-1])
    hd = _unwrap(hd)
    raw_k = [0.0] + [(hd[i] - hd[i - 1]) / DS for i in range(1, n)]
    kappa = _gauss_smooth(raw_k, 2.0)  # for steering (ackermann)
    # peak |curvature| nearby, for speed limits (so wheels never saturate in corners)
    k_peak = [max(abs(k) for k in raw_k[max(0, i - 3):i + 4]) for i in range(n)]

    drive = cfg.get("drive", "differential")
    vmax = cfg["max_speed_mps"]  # ground speed at 100% motor power
    v_cruise = vmax * cfg.get("cruise_fraction", 0.6) * max(0.05, min(1.0, speed_scale))
    a_max = cfg.get("max_accel_mps2", 0.8)
    a_lat = cfg.get("max_lat_accel_mps2", 1.5)
    W = cfg.get("track_width_m", 0.14)
    L = cfg.get("wheelbase_m", 0.18)
    steer_max = math.radians(cfg.get("max_steer_deg", 30))

    theta = hd  # the heading the car should have at each sample
    if drive == "ackermann":
        k_lim = math.tan(steer_max) / L
        worst = max(abs(k) for k in kappa)
        if worst > k_lim * 1.05:
            warnings.append(
                f"Path has turns tighter than this car can steer "
                f"(radius {100 / worst:.0f} cm vs minimum {100 / k_lim:.0f} cm). "
                f"Those parts will come out wider. Draw bigger curves.")
        kappa = [max(-k_lim, min(k_lim, k)) for k in kappa]
        theta = [hd[0]]
        for k in kappa[1:]:
            theta.append(theta[-1] + k * DS)

    # Velocity limits per point.
    v = []
    for i, k in enumerate(k_peak if drive == "differential" else kappa):
        k = abs(k)
        lim = v_cruise
        if k > 1e-6:
            lim = min(lim, math.sqrt(a_lat / k))
        if drive == "differential":
            # outer wheel must not exceed 100% (with a 10% margin): v * (1 + k W/2) <= vmax
            lim = min(lim, 0.9 * vmax / (1 + k * W / 2))
        v.append(lim)
    v[0] = v[-1] = 0.0
    for i in range(1, n):  # accelerate
        v[i] = min(v[i], math.sqrt(v[i - 1] ** 2 + 2 * a_max * DS))
    for i in range(n - 2, -1, -1):  # decelerate
        v[i] = min(v[i], math.sqrt(v[i + 1] ** 2 + 2 * a_max * DS))

    # Time at each sample (constant acceleration between samples).
    t = [0.0]
    for i in range(1, n):
        t.append(t[-1] + 2 * DS / max(v[i - 1] + v[i], 1e-9))
    duration = t[-1]

    def s_at(tt):
        """Arc-length position along the path at time tt."""
        j = min(max(bisect.bisect_right(t, tt) - 1, 0), n - 2)
        tau, span = tt - t[j], t[j + 1] - t[j]
        acc = (v[j + 1] - v[j]) / span
        return min(j * DS + v[j] * tau + 0.5 * acc * tau * tau, (n - 1) * DS)

    def lerp(arr, s):
        x = s / DS
        j = min(int(x), n - 2)
        return arr[j] + (x - j) * (arr[j + 1] - arr[j])

    # Sample the desired trajectory at the control rate. Each tick's command is the
    # exact change in position/heading over that tick, so integrating the commands
    # reproduces the path (no drift from interpolating v*kappa).
    hz = cfg.get("control_hz", 50)
    dt = 1.0 / hz
    steps = int(math.ceil(duration / dt))
    s_ticks = [s_at(min(k * dt, duration)) for k in range(steps + 1)]
    th_ticks = [lerp(theta, s) for s in s_ticks]
    commands = []
    for k in range(steps):
        ds_ = s_ticks[k + 1] - s_ticks[k]
        dth = th_ticks[k + 1] - th_ticks[k]
        vv, w = ds_ / dt, dth / dt
        if drive == "differential":
            vl, vr = (vv - w * W / 2) / vmax, (vv + w * W / 2) / vmax
            commands.append([round(max(-1, min(1, vl)), 4), round(max(-1, min(1, vr)), 4)])
        else:
            kk = dth / ds_ if ds_ > 1e-5 else lerp(kappa, s_ticks[k])
            steer = max(-1.0, min(1.0, math.atan(L * kk) / steer_max))
            commands.append([round(vv / vmax, 4), round(steer, 4)])
    commands.append([0.0, 0.0])

    sim = simulate(commands, cfg, pts[0], hd[0])
    err = max(_dist_to_polyline(q, pts) for q in sim[::5])
    if err > 0.10:
        warnings.append(f"Simulated car drifts up to {err * 100:.0f} cm from the drawing.")
    return {
        "drive": drive,
        "dt": dt,
        "duration_s": round(duration, 2),
        "length_m": round(DS * (n - 1), 2),
        "start": {"x": pts[0][0], "y": pts[0][1], "heading_deg": round(math.degrees(hd[0]), 1)},
        "commands": commands,
        "smoothed": [[round(x, 4), round(y, 4)] for x, y in pts[::2]],
        "sim": [[round(x, 4), round(y, 4)] for x, y in sim],
        "max_sim_error_m": round(err, 3),
        "warnings": warnings,
    }


def simulate(commands, cfg, start_xy, start_heading):
    """Integrate the commands with the ideal kinematic model (what the car *should* do)."""
    vmax = cfg["max_speed_mps"]
    dt = 1.0 / cfg.get("control_hz", 50)
    W = cfg.get("track_width_m", 0.14)
    L = cfg.get("wheelbase_m", 0.18)
    x, y = start_xy
    th = start_heading
    out = [(x, y)]
    for a, b in commands:
        if cfg.get("drive", "differential") == "differential":
            vl, vr = a * vmax, b * vmax
            v, w = (vl + vr) / 2, (vr - vl) / W
        else:
            v = a * vmax
            w = v * math.tan(b * math.radians(cfg.get("max_steer_deg", 30))) / L
        # midpoint integration
        x += v * dt * math.cos(th + w * dt / 2)
        y += v * dt * math.sin(th + w * dt / 2)
        th += w * dt
        out.append((x, y))
    return out
