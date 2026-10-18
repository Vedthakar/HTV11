import {clock, REPORT_LABEL, STATUS_META} from '../mission/format.ts';
import {useMissionPlayback} from '../mission/useMissionPlayback.ts';

/** List of every site report across rovers; choosing one opens that site. */
export function ReportsPanel({onClose, onOpen}: {onClose(): void; onOpen(siteId: string): void}) {
  const {state, store} = useMissionPlayback();
  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="reports card" role="dialog" aria-modal="true" aria-labelledby="reports-title" onMouseDown={e => e.stopPropagation()}>
        <header>
          <h2 id="reports-title" className="display">Site reports</h2>
          <button className="close" onClick={onClose} aria-label="Close reports">×</button>
        </header>
        <table className="reports-table">
          <thead className="mono"><tr><th>Site</th><th>Rover</th><th>Status</th><th>Report</th><th>Arrived</th></tr></thead>
          <tbody>
            {state.missions.flatMap(m => m.sites.map(s => {
              const status = store.siteStatus(s);
              return (
                <tr key={s.id}>
                  <td><button className="link mono" onClick={() => { onOpen(s.id); onClose(); }}>{s.label}</button><div className="muted">{s.area}</div></td>
                  <td className="mono">{m.roverId}</td>
                  <td><span className="status-badge small mono" data-status={status}>{STATUS_META[status].icon} {STATUS_META[status].label}</span></td>
                  <td>{REPORT_LABEL[store.reportStatus(s)]}</td>
                  <td className="mono">{clock(s.arrivedAt)}</td>
                </tr>
              );
            }))}
          </tbody>
        </table>
        <p className="disclaimer mono">Automated flags are not a certified inspection.</p>
      </div>
    </div>
  );
}
