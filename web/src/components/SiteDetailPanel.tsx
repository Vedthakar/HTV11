import {clock, duration, REPORT_LABEL, SCAN_FAILURE_NOTE, STATUS_META} from '../mission/format.ts';
import type {ReportStatus} from '../mission/types.ts';
import {useMissionPlayback} from '../mission/useMissionPlayback.ts';
import {scanThumbnailSvg} from '../map/scanThumbnail.ts';

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
        {inspected && status !== 'failed' && site.hazards.length === 0 && <p className="muted">No hazards flagged.</p>}
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

      <section>
        <div className="scan-preview" aria-label={`Scan preview for ${site.label} (simulated)`} role="img">
          {site.scanPreviewUrl ? <img src={site.scanPreviewUrl} alt={`Scan preview for ${site.label}`} />
            : status === 'pending' ? <span className="mono">[ NO SCAN YET ]</span>
            : <span className="scan-render" dangerouslySetInnerHTML={{__html: scanThumbnailSvg({...site, status}, {width: 160, height: 100, count: 520})}} />}
          {!site.scanPreviewUrl && status !== 'pending' && <span className="scan-caption mono">Simulated preview</span>}
        </div>
        <a className="btn-secondary" href="/studio.html" title="Opens the Capture studio. Linking a site to its scan is not wired up yet.">View 3D scan</a>
      </section>

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
