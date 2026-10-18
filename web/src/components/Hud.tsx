import {useEffect, useRef} from 'react';
import {coordLabel, duration, km, missionDay} from '../mission/format.ts';
import {missionDistanceM, missionEnd, poseAt} from '../mission/track.ts';
import {useMissionPlayback} from '../mission/useMissionPlayback.ts';

export const PRODUCT_NAME = 'Premiere';

/** Top-left title block: product, mission summary line, live rover coordinates. */
export function MissionTitle() {
  const {state, store} = useMissionPlayback();
  const coords = useRef<HTMLSpanElement>(null);
  const m = store.active;

  useEffect(() => {
    let last = '';
    return store.onFrame(t => {
      const pose = poseAt(store.active.track, t);
      const text = `[ ${coordLabel(pose?.coord ?? store.active.plannedRoute?.[0] ?? [0, 0])} ]`;
      if (text !== last && coords.current) coords.current.textContent = last = text;
    });
  }, [store, state.activeId, state.missions]);

  return (
    <header className="hud-title">
      <h1><span className="display">{PRODUCT_NAME}.</span> <span className="mono bracket">[ MISSION LOG ]</span></h1>
      <p className="mono subtitle">
        {missionDay(m.startedAt)} · {m.roverId} · {m.sites.length} site{m.sites.length === 1 ? '' : 's'} · {km(missionDistanceM(m))} · {duration(missionEnd(m) - m.startedAt)}
      </p>
      <p className="mono coords"><span ref={coords} aria-live="off" /></p>
      <p className="hud-tags mono">
        {state.isMock && <span className="tag tag-demo" title="Simulated mission and sites; not real inspection results">Mission Map</span>}
        <a className="tag tag-link" href="/studio.html">Capture studio ↗</a>
      </p>
    </header>
  );
}

interface TopBarProps { onSearch(): void; onReports(): void; onRecentre(): void; }

/** Top-right controls: search, reports, LIVE/REPLAY, follow rover. */
export function TopBar({onSearch, onReports, onRecentre}: TopBarProps) {
  const {state, store} = useMissionPlayback();
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <nav className="hud-top-right" aria-label="Mission controls">
      <div className="hud-row">
        <button className="search-box card" onClick={onSearch} aria-label="Find a site or rover" aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
          <span>Find a site…</span><kbd className="mono">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
        <button className="pill card" onClick={onReports}>Reports</button>
      </div>
      <div className="hud-row">
        <div className="mode-toggle card mono" role="group" aria-label="Mode">
          <button aria-pressed={state.mode === 'live'} onClick={() => store.setMode('live')}><span className="live-dot" aria-hidden="true" />LIVE</button>
          <button aria-pressed={state.mode === 'replay'} onClick={() => store.setMode('replay')}>REPLAY</button>
        </div>
        <button className="pill card mono follow" aria-pressed={state.follow} aria-keyshortcuts="F" onClick={() => store.setFollow(!state.follow)}>
          {state.follow ? '◉' : '○'} Follow rover
        </button>
      </div>
      {state.followDetached && (
        <button className="pill card mono recentre" onClick={onRecentre}>⌖ Re-centre</button>
      )}
      {state.mode === 'live' && state.feed !== 'open' && state.feed !== 'closed' && (
        <p className="feed-status mono" role="status">[ FEED {state.feed.toUpperCase()} ]</p>
      )}
    </nav>
  );
}
