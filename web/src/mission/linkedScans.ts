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

// Demo mission sites have no verified municipal-building mapping. Never pair an
// unrelated uploaded capture automatically. Civic selections use saved links in studio.
export async function linkedScanFor(_siteId: string): Promise<LinkedScan | null> {
  return null;
}
