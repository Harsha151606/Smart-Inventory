import ForecastChart from './ForecastChart.jsx';
import { formatMoney } from '../utils/format.js';

export default function AnalyticsView({
  insights,
  items,
  forecastItemId,
  forecastData,
  auditResult,
  auditLoading,
  theme,
  onSelectForecastItem,
  onVerifyAuditChain,
  onApplyThreshold,
  onInspectItem
}) {
  const threshold = forecastData?.[0]?.threshold ?? 0;

  let auditClass = 'audit-box';
  let auditMessage = 'Click Verify Ledger to run a full SHA-256 chain check.';
  if (auditLoading) {
    auditMessage = 'Verifying SHA-256 hash chain...';
  } else if (auditResult) {
    if (auditResult.valid) {
      auditClass = 'audit-box valid';
      auditMessage = `VERIFIED: ${auditResult.checked_count} transaction records checked. Zero tampering detected. Chain head: ${auditResult.latest_hash}`;
    } else {
      auditClass = 'audit-box invalid';
      auditMessage = `TAMPER ALERT: Chain broken at record #${auditResult.tampered_record_id} (${auditResult.reason}).`;
    }
  }

  return (
    <section id="view-analytics" className="view">
      <div className="panel mb-16">
        <div className="panel-head">
          <div>
            <h3>Cryptographic Audit Ledger Integrity</h3>
            <p className="muted-text">
              Recomputes every SHA-256 chain link from genesis across all inventory mutations.
            </p>
          </div>
          <button
            id="btn-verify-chain"
            type="button"
            className="btn btn-primary"
            disabled={auditLoading}
            onClick={onVerifyAuditChain}
          >
            {auditLoading ? 'Verifying...' : 'Verify Ledger'}
          </button>
        </div>
        <div id="audit-status-box" className={`${auditClass} tabular-nums`}>
          {auditMessage}
        </div>
      </div>

      <div className="panel mb-16">
        <div className="panel-head">
          <h3>14-Day Demand &amp; Depletion Forecast</h3>
          <select
            id="forecast-item-select"
            className="select"
            aria-label="Select item for forecast"
            value={forecastItemId ? String(forecastItemId) : ''}
            onChange={(e) => {
              if (e.target.value) onSelectForecastItem(Number(e.target.value));
            }}
          >
            {items.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {`${item.name} (${item.quantity} ${item.unit || 'pcs'})`}
              </option>
            ))}
          </select>
        </div>
        <ForecastChart
          forecast={forecastData || []}
          threshold={threshold}
          width={840}
          height={280}
          theme={theme}
        />
      </div>

      <div className="stack">
        {(insights || []).map((ins, idx) => {
          if (ins.type === 'summary') {
            const barCls =
              ins.health_score >= 70
                ? 'progress-ok'
                : ins.health_score >= 40
                ? 'progress-low'
                : 'progress-out';
            return (
              <div key={`an-sum-${idx}`} className="panel">
                <div className="label-row">
                  <h3>Overall Inventory Health</h3>
                  <strong className="text-accent tabular-nums">{ins.health_score}%</strong>
                </div>
                <progress className={`progress-bar ${barCls}`} max={100} value={ins.health_score} />
                <p className="muted-text tabular-nums">
                  {`${ins.total_items} SKUs · ${ins.low_stock} low · ${ins.out_of_stock} out · Total value ${formatMoney(ins.total_value)}`}
                </p>
              </div>
            );
          }

          if (ins.type === 'critical_stock') {
            return (
              <div key={`an-crit-${idx}`} className="panel">
                <h3 className="panel-title text-danger">Critical Depletion Watchlist</h3>
                <div className="stack">
                  {(ins.items || []).map((x) => (
                    <div key={x.id} className="activity-row">
                      <strong>{x.name}</strong>
                      <button
                        type="button"
                        className="btn-link tabular-nums"
                        onClick={() => onInspectItem(x.id)}
                      >
                        {x.quantity === 0 ? 'OUT -> Inspect' : `~${x.days ?? '?'} days -> Inspect`}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          }

          if (ins.type === 'threshold_adjustment') {
            return (
              <div key={`an-thresh-${ins.item_id}-${idx}`} className="insight-item">
                <div className="label-row">
                  <strong className="text-warn">{ins.item_name}</strong>
                  <button
                    type="button"
                    className="btn btn-secondary tabular-nums"
                    onClick={() => onApplyThreshold(ins.item_id, ins.suggested_threshold)}
                  >
                    {`Set Threshold to ${ins.suggested_threshold}`}
                  </button>
                </div>
                <p className="muted-text">{ins.message}</p>
              </div>
            );
          }

          return null;
        })}
      </div>
    </section>
  );
}
