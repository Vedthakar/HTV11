// Links mission sites to real captures served by the capture-studio backend (/api/sessions).
// The demo mission has no scans of its own, so selected sites are paired with an uploaded capture to show what a
// real site preview looks like. Without the backend (e.g. a static deploy) nothing links and the UI falls back.

export interface LinkedScan {
  sessionId: string;
  name: string;
  cloudUrl: string;
  trajectoryUrl: string | null;
  /** True when the pairing is illustrative (demo site + real capture), not this site's own scan. */
  demoPairing: boolean;
}

interface SessionSummary {
  id: string; name?: string; created_at: number; demo?: boolean;
  cloud_url: string | null; trajectory_url: string | null;
}

/** Demo pairings: site id → which uploaded capture to show. 'first' = the earliest real (non-synthetic) upload. */
const DEMO_SCAN_LINKS: Record<string, 'first'> = {'SITE-01': 'first'};

let sessions: Promise<SessionSummary[]> | null = null;

function loadSessions(): Promise<SessionSummary[]> {
  sessions ??= fetch('/api/sessions')
    .then(r => (r.ok ? r.json() as Promise<SessionSummary[]> : []))
    .catch(() => [])
    .then(list => { if (!list.length) sessions = null; return list; }); // retry later if the backend was down
  return sessions;
}

export async function linkedScanFor(siteId: string): Promise<LinkedScan | null> {
  if (!DEMO_SCAN_LINKS[siteId]) return null;
  const real = (await loadSessions()).filter(s => !s.demo && s.cloud_url).sort((a, b) => a.created_at - b.created_at);
  const first = real[0];
  if (!first?.cloud_url) return null;
  return {sessionId: first.id, name: first.name ?? first.id, cloudUrl: first.cloud_url, trajectoryUrl: first.trajectory_url, demoPairing: true};
}
