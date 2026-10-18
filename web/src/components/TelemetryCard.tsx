import {useEffect, useRef} from 'react';
import {km} from '../mission/format.ts';
import {distanceAlongM, missionDistanceM, poseAt, siteStatusAt} from '../mission/track.ts';
import {useMissionPlayback} from '../mission/useMissionPlayback.ts';

const UPDATE_MS = 100;

/** Live readout for the active rover. Values are written to the DOM ~10×/s from the frame loop, not via React. */
export function TelemetryCard() {
  const {state, store} = useMissionPlayback();
  const root = useRef<HTMLElement>(null);
  const m = store.active;

  useEffect(() => {
    let last = 0;
    const set = (key: string, text: string) => { const el = root.current?.querySelector<HTMLElement>(`[data-k="${key}"]`); if (el && el.textContent !== text) el.textContent = text; };
    const bar = (key: string, f: number | null) => root.current?.querySelector<HTMLElement>(`[data-bar="${key}"]`)?.style.setProperty('--f', f == null ? '0' : String(Math.max(0, Math.min(1, f))));
    return store.onFrame(t => {
      const now = performance.now();
      if (now - last < UPDATE_MS) return;
      last = now;
      const mission = store.active, pose = poseAt(mission.track, t);
      const started = pose && t >= mission.track[0].t, ended = mission.endedAt != null && t >= mission.endedAt;
      const here = mission.sites.find(s => siteStatusAt(s, t) === 'inspecting');
      const done = mission.sites.filter(s => { const st = siteStatusAt(s, t); return st !== 'pending' && st !== 'inspecting'; }).length;

      set('state', !started ? 'STANDBY' : ended ? 'MISSION COMPLETE' : here ? `SCANNING ${here.label}` : (pose!.speed > 0.05 ? 'DRIVING' : 'HOLDING'));
      root.current?.setAttribute('data-state', !started ? 'standby' : ended ? 'complete' : here ? 'scanning' : 'driving');

      const battery = pose?.batteryPct;
      set('battery', battery != null ? `${Math.round(battery)}%` : '—');
      bar('battery', battery != null ? battery / 100 : null);
      root.current?.querySelector('[data-bar="battery"]')?.classList.toggle('is-low', battery != null && battery < 25);

      const signal = pose?.signalPct;
      set('signal', signal != null ? `${Math.round(signal)}%` : '—');
      root.current?.querySelectorAll<HTMLElement>('.sig-bars i').forEach((el, i) => el.classList.toggle('on', signal != null && signal > i * 25 + 5));

      set('speed', pose && started && !ended ? `${(pose.speed * 3.6).toFixed(1)}` : '0.0');

      // Scan progress: sites finished, plus how far into the current scan (when its end time is known).
      const total = mission.sites.length;
      const partial = here?.arrivedAt != null && here.departedAt != null ? (t - here.arrivedAt) / (here.departedAt - here.arrivedAt) : 0;
      set('scan', `${done}/${total}${here ? ` · ${here.departedAt != null ? `${Math.round(partial * 100)}%` : 'scanning'}` : ''}`);
      bar('scan', total ? (done + partial) / total : 0);

      const driven = distanceAlongM(mission.track, t), planned = missionDistanceM(mission);
      set('distance', `${km(driven)} / ${km(planned)}`);
      bar('distance', planned ? driven / planned : 0);
    });
  }, [store, state.activeId, state.missions]);

  return (
    <section ref={root} className="telemetry card" aria-label={`${m.roverId} telemetry`} style={{['--accent' as string]: m.color ?? '#F25C24'}}>
      <header>
        <span className="tl-rover mono"><i className="tl-swatch" aria-hidden="true" />{m.roverId}</span>
        <span className="tl-state mono" data-k="state" role="status">STANDBY</span>
      </header>
      <dl>
        <div><dt>Battery</dt><dd className="mono" data-k="battery">—</dd><span className="tl-bar" data-bar="battery" aria-hidden="true" /></div>
        <div><dt>Signal</dt><dd className="mono" data-k="signal">—</dd><span className="sig-bars" aria-hidden="true"><i /><i /><i /><i /></span></div>
        <div><dt>Speed</dt><dd className="mono"><span data-k="speed">0.0</span> <small>km/h</small></dd></div>
        <div><dt>Scan progress</dt><dd className="mono" data-k="scan">0/0</dd><span className="tl-bar" data-bar="scan" aria-hidden="true" /></div>
        <div className="tl-wide"><dt>Distance travelled</dt><dd className="mono" data-k="distance">0.0 km</dd><span className="tl-bar" data-bar="distance" aria-hidden="true" /></div>
      </dl>
    </section>
  );
}
