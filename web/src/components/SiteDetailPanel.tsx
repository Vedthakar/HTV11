import {useEffect, useState} from 'react';
import {clock, duration, REPORT_LABEL, SCAN_FAILURE_NOTE, STATUS_META} from '../mission/format.ts';
import type {ReportStatus, Site, SiteStatus} from '../mission/types.ts';
import {useMissionPlayback} from '../mission/useMissionPlayback.ts';
import {scanThumbnailSvg} from '../map/scanThumbnail.ts';
import {linkedScanFor, type LinkedScan} from '../mission/linkedScans.ts';
import {ScanViewer} from './ScanViewer.tsx';

const REPORT_STEPS: ReportStatus[] = ['draft', 'awaiting_confirmation', 'submitted'];

/** Paper-card panel for the selected site: right-hand drawer on desktop, bottom sheet on narrow screens. */
export function SiteDetailPanel() {
  const {state, store} = useMissionPlayback();
  const found = store.findSite(state.selectedSiteId);
  if (!found) return null;
  const {site, mission} = found;
  const status = store.siteStatus(site);
  const meta = STATUS_META[status];
  const report = store.reportStatus(site);
  const inspected = status !== 'pending' && status !== 'inspecting';
  const onSite = site.arrivedAt != null && site.departedAt != null && status !== 'inspecting' ? site.departedAt - site.arrivedAt : null;

  return (
    <aside className="site-panel card" aria-labelledby="site-panel-title" role="dialog" aria-modal="false">
      <div className="sheet-grip" aria-hidden="true" />
      <header>
        <p className="mono eyebrow">[ {mission.roverId} · {mission.id} ]</p>
        <h2 id="site-panel-title" className="display">{site.label}</h2>
        <p className="area">{site.area} <span className="muted mono">· approximate area (demo)</span></p>
        <button className="close" onClick={() => store.select(null)} aria-label="Close site details (Esc)">×</button>
      </header>

      <div className="status-badge mono" data-status={status}><span aria-hidden="true">{meta.icon}</span> {meta.label}</div>

      <dl className="site-times mono">
        <div><dt>Arrived</dt><dd>{clock(site.arrivedAt)}</dd></div>
        <div><dt>Departed</dt><dd>{status === 'inspecting' ? 'on site' : clock(site.departedAt)}</dd></div>
        <div><dt>Time on site</dt><dd>{onSite != null ? duration(onSite) : '—'}</dd></div>
      </dl>

      <section>
        <h3 className="mono">Possible hazards flagged for human follow-up</h3>
        {!inspected && <p className="muted">{status === 'pending' ? 'Not yet inspected.' : 'Inspection in progress…'}</p>}
        {inspected && status === 'failed' && <p className="muted">{SCAN_FAILURE_NOTE} Re-scan recommended.</p>}
        {site.simulated && <p className="muted">Simulated survey stop only. No inspection or safety assessment was performed.</p>}
        {inspected && !site.simulated && status !== 'failed' && site.hazards.length === 0 && <p className="muted">No hazards flagged.</p>}
        {inspected && site.hazards.length > 0 && (
          <ul className="hazards">
            {site.hazards.map(h => (
              <li key={h.type}>
                <span className="hazard-type">{h.type}</span>
                <span className={`confidence mono c-${h.confidence}`}>{h.confidence} confidence</span>
                {h.note && <span className="hazard-note">{h.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ScanPreview site={site} status={status} />

      <section>
        <h3 className="mono">Report</h3>
        <ol className="report-steps mono">
          {REPORT_STEPS.map((s, i) => (
            <li key={s} data-done={REPORT_STEPS.indexOf(report) >= i} aria-current={report === s ? 'step' : undefined}>{REPORT_LABEL[s]}</li>
          ))}
        </ol>
        <button className="btn-primary" disabled={!inspected || report === 'submitted'} onClick={() => store.advanceReport(site.id)}>
          {report === 'draft' ? 'Send for operator confirmation' : report === 'awaiting_confirmation' ? 'Confirm & submit report' : 'Report submitted ✓'}
        </button>
      </section>

      <p className="disclaimer mono">Automated flags are not a certified inspection.</p>
    </aside>
  );
}

/**
 * Scan area of the site panel. A site linked to a real capture (see linkedScans.ts) gets an interactive 3D view
 * of that point cloud; otherwise the simulated thumbnail, or a placeholder before the rover arrives.
 */
function ScanPreview({site, status}: {site: Site; status: SiteStatus}) {
  const [linked, setLinked] = useState<LinkedScan | null>(null);
  useEffect(() => {
    let live = true;
    setLinked(null);
    linkedScanFor(site.id).then(scan => { if (live) setLinked(scan); });
    return () => { live = false; };
  }, [site.id]);

  const reached = status !== 'pending';
  return (
    <section>
      {linked && reached ? (
        <>
          <div className="scan-preview is-live">
            <ScanViewer cloudUrl={linked.cloudUrl} trajectoryUrl={linked.trajectoryUrl} label={linked.name} />
            <span className="scan-caption mono">LIVE 3D · drag to orbit</span>
          </div>
          <p className="scan-source mono" title={linked.name}>
            {linked.demoPairing ? 'Demo pairing: ' : ''}{linked.name}
          </p>
        </>
      ) : (
        <div className="scan-preview" aria-label={`Scan preview for ${site.label} (simulated)`} role="img">
          {site.scanPreviewUrl ? <img src={site.scanPreviewUrl} alt={`Scan preview for ${site.label}`} />
            : !reached ? <span className="mono">[ NO SCAN YET ]</span>
            : <span className="scan-render" dangerouslySetInnerHTML={{__html: scanThumbnailSvg({...site, status}, {width: 160, height: 100, count: 520})}} />}
          {!site.scanPreviewUrl && reached && <span className="scan-caption mono">Simulated preview</span>}
        </div>
      )}
      <a className="btn-secondary" href="/studio.html" title="Opens the Capture studio">View 3D scan</a>
    </section>
  );
}
