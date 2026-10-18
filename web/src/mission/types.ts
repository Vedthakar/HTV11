// Domain types for the rover mission map. Coordinates are always [lng, lat]; times are epoch ms.

export type LngLat = [number, number];

export type SiteStatus = 'pending' | 'inspecting' | 'cleared' | 'hazards' | 'failed';

export type ReportStatus = 'draft' | 'awaiting_confirmation' | 'submitted';

export interface Hazard { type: string; confidence: 'low' | 'medium' | 'high'; note?: string; }

export interface Site {
  simulated?: boolean;
  id: string;              // "SITE-03"
  label: string;           // display label, e.g. "SITE 03"
  area: string;            // neighbourhood-level only, never a street address
  coord: LngLat;
  status: SiteStatus;      // final status once inspected; 'pending'/'inspecting' while a live mission runs
  arrivedAt?: number;
  departedAt?: number;
  hazards: Hazard[];
  reportStatus: ReportStatus;
  scanPreviewUrl?: string;
}

export interface TelemetryPoint { t: number; coord: LngLat; heading: number; speed: number; batteryPct?: number; signalPct?: number; }

export interface Mission {
  id: string;
  roverId: string;
  startedAt: number;
  endedAt?: number;
  track: TelemetryPoint[];
  plannedRoute?: LngLat[];
  sites: Site[];
  /** Expected end for a mission still in progress; sizes the LIVE timeline. */
  plannedEndAt?: number;
  /** Accent colour for this rover's marker and traveled path. */
  color?: string;
}
