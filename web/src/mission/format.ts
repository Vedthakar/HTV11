import type {SiteStatus} from './types.ts';

export const TIME_ZONE = 'America/Toronto';

const clockFmt = new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
const clockSecFmt = new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'});
const dayFmt = new Intl.DateTimeFormat('en-US', {timeZone: TIME_ZONE, weekday: 'long', month: 'short', day: 'numeric'});

/** "14:32" in Toronto time. */
export const clock = (ms?: number) => (ms == null ? '--:--' : clockFmt.format(ms));
export const clockSec = (ms: number) => clockSecFmt.format(ms);
/** "Saturday, Oct 17" */
export const missionDay = (ms: number) => dayFmt.format(ms);

/** Playback counter: "0:00", "12:05", "2:10:09". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** "2h 10m", "14 min" */
export function duration(ms: number): string {
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : `${min} min`;
}

export const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

export function coordLabel([lng, lat]: [number, number]): string {
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'} · ${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;
}

/** Text and icon for each status, so colour is never the only cue. */
export const STATUS_META: Record<SiteStatus, {label: string; icon: string}> = {
  pending: {label: 'Pending', icon: '○'},
  inspecting: {label: 'Inspecting now', icon: '◉'},
  cleared: {label: 'Cleared', icon: '✓'},
  hazards: {label: 'Hazards flagged', icon: '!'},
  failed: {label: 'Scan failed', icon: '✕'},
};

export const REPORT_LABEL = {draft: 'Draft', awaiting_confirmation: 'Awaiting operator confirmation', submitted: 'Submitted'} as const;

export const SCAN_FAILURE_NOTE = 'Scan incomplete: LiDAR coverage below threshold.';
