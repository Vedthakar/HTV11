import {useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent} from 'react';
import {missionEvents, type MissionEvent} from '../mission/events.ts';
import {clock, clockSec, elapsed} from '../mission/format.ts';
import {SPEEDS} from '../mission/store.ts';
import {useMissionPlayback} from '../mission/useMissionPlayback.ts';

const ICON: Record<MissionEvent['kind'], string> = {depart: '↗', arrive: '◎', scan: '✓', 'scan-failed': '✕', hazards: '!', return: '⌂'};

interface Props { onFocusSite(siteId: string): void; }

/** Left-hand mission log: slim playback strip on top, then a timestamped event list. Clicking an event seeks to it. */
export function MissionLog({onFocusSite}: Props) {
  const {state, store} = useMissionPlayback();
  const mission = store.active;
  const events = useMemo(() => missionEvents(mission), [mission]);
  const [start, end] = store.span;
  const live = state.mode === 'live';
  const [expanded, setExpanded] = useState(false); // narrow screens: list collapses under the controls
  const [hover, setHover] = useState<{x: number; label: string} | null>(null);
  const timeText = useRef<HTMLSpanElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const slider = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);

  // Per frame: time, scrubber, and which events are past/current. DOM only, no React render.
  useEffect(() => {
    let current = -2;
    return store.onFrame(t => {
      const [s, e] = store.span, f = Math.min(1, Math.max(0, (t - s) / (e - s)));
      if (timeText.current) timeText.current.textContent = elapsed(t - s);
      if (fill.current) fill.current.style.setProperty('--f', String(f));
      slider.current?.setAttribute('aria-valuenow', String(Math.round((t - s) / 1000)));
      slider.current?.setAttribute('aria-valuetext', `${elapsed(t - s)} elapsed, ${clockSec(t)}`);
      let idx = -1;
      for (let i = 0; i < events.length && events[i].t <= t; i++) idx = i;
      if (idx === current || !list.current) return;
      current = idx;
      list.current.querySelectorAll<HTMLLIElement>('li').forEach((li, i) => {
        li.classList.toggle('is-past', i <= idx);
        li.classList.toggle('is-current', i === idx);
      });
      list.current.children[Math.max(0, idx)]?.scrollIntoView({block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    });
  }, [store, events]);

  const timeAt = (clientX: number) => {
    const r = slider.current!.getBoundingClientRect();
    return start + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (end - start);
  };
  const ticks = mission.sites.filter(s => s.arrivedAt != null);
  const onPointerDown = (e: ReactPointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); store.seek(timeAt(e.clientX)); };
  const onPointerMove = (e: ReactPointerEvent) => {
    const r = slider.current!.getBoundingClientRect(), t = timeAt(e.clientX);
    const near = ticks.find(s => Math.abs((s.arrivedAt! - start) / (end - start) * r.width - (e.clientX - r.left)) < 7);
    setHover({x: e.clientX - r.left, label: near ? `${clock(near.arrivedAt)} · ${near.label}` : clockSec(t)});
    if (e.currentTarget.hasPointerCapture(e.pointerId)) store.seek(t);
  };
  const onKey = (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? 300_000 : 30_000;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') store.seekBy(step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') store.seekBy(-step);
    else if (e.key === 'Home') store.seek(start);
    else if (e.key === 'End') store.seek(end);
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  const openEvent = (ev: MissionEvent) => { store.seek(ev.t); if (ev.siteId) onFocusSite(ev.siteId); };

  const status = live ? (state.liveComplete ? 'COMPLETE' : 'LIVE') : state.playing ? 'PLAYING' : 'PAUSED';

  return (
    <aside className={`mission-log card${expanded ? ' is-expanded' : ''}`} aria-label="Mission log and playback">
      <div className="log-strip">
        <button className="log-play" onClick={() => (live ? store.setMode('replay') : store.toggle())}
          aria-label={live ? 'Switch to replay' : state.playing ? 'Pause' : 'Play'}>
          {state.playing && !live
            ? <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5" y="4" width="3.4" height="12" rx="1" /><rect x="11.6" y="4" width="3.4" height="12" rx="1" /></svg>
            : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 4.2v11.6a.6.6 0 0 0 .9.5l9-5.8a.6.6 0 0 0 0-1L7.4 3.7a.6.6 0 0 0-.9.5z" /></svg>}
        </button>
        <span className="log-time mono" aria-hidden="true"><span ref={timeText}>0:00</span><span className="muted"> / {elapsed(end - start)}</span></span>
        <span className={`log-status mono${live && !state.liveComplete ? ' is-live' : ''}`} role="status">[ {status} ]</span>
        <div className="log-speed mono" role="group" aria-label="Playback speed">
          {SPEEDS.map(s => <button key={s} aria-pressed={state.speed === s} disabled={live} onClick={() => store.setSpeed(s)}>{s}×</button>)}
        </div>
        <div ref={slider} className="log-scrub" role="slider" tabIndex={0} aria-label={`Mission timeline for ${mission.roverId}`}
          aria-valuemin={0} aria-valuemax={Math.round((end - start) / 1000)}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerLeave={() => setHover(null)} onKeyDown={onKey}>
          <div ref={fill} className="scrub-track" />
          {ticks.map(s => {
            const tickStatus = live ? store.siteStatus(s) : s.status;
            return <span key={s.id} className="scrub-tick" data-status={tickStatus} style={{left: `${(s.arrivedAt! - start) / (end - start) * 100}%`}} />;
          })}
          {hover && <span className="scrub-hover mono" style={{left: hover.x}}>{hover.label}</span>}
        </div>
      </div>

      <div className="log-head mono">
        <span>MISSION LOG · {mission.id}</span>
        <button className="log-toggle" aria-expanded={expanded} onClick={() => setExpanded(x => !x)}>{expanded ? 'Hide' : 'Log'} ▾</button>
      </div>
      <ol ref={list} className="log-events">
        {events.map(ev => (
          <li key={ev.id} data-kind={ev.kind} data-status={ev.status}>
            <button onClick={() => openEvent(ev)} aria-label={`${clock(ev.t)} ${ev.label}${ev.detail ? `, ${ev.detail}` : ''}. Seek here.`}>
              <span className="ev-time mono">{clock(ev.t)}</span>
              <span className="ev-icon mono" aria-hidden="true">{ICON[ev.kind]}</span>
              <span className="ev-body"><span className="ev-label">{ev.label}</span>{ev.detail && <span className="ev-detail">{ev.detail}</span>}</span>
            </button>
          </li>
        ))}
        {live && !state.liveComplete && <li className="ev-waiting mono">Awaiting telemetry…</li>}
      </ol>
      <p className="log-legend mono" aria-label="Map legend">
        <span><i className="lg-trail" />driven</span><span><i className="lg-planned" />planned</span>
      </p>
    </aside>
  );
}
