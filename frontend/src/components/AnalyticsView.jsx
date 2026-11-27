import { useMemo } from 'react';
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
  const selectedItem = items.find((i) => i.id === forecastItemId);
  const threshold = forecastData?.[0]?.threshold ?? selectedItem?.threshold ?? 0;
  const summary = (insights || []).find((x) => x.type === 'summary');

  const recommendationRows = useMemo(() => {
    const rows = [];
    for (const ins of insights || []) {
      if (ins.type === 'critical_stock') {
        for (const x of ins.items || []) {
          rows.push({
            key: `crit-${x.id}`,
            itemId: x.id,
            itemName: x.name,
            metric: x.quantity === 0 ? '0 units left' : `${x.quantity} units (~${x.days ?? '?'}d)`,
            badgeClass: 'badge-out',
            badgeLabel: x.quantity === 0 ? 'Out of Stock' : 'Critical Reorder',
            recommendation:
              x.quantity === 0
                ? 'Immediate replenishment required.'
                : `Projected to hit reorder threshold in ~${x.days ?? '?'} days.`,
            actionType: 'inspect'
          });
        }
      } else if (ins.type === 'threshold_adjustment') {
        rows.push({
          key: `thresh-${ins.item_id}`,
          itemId: ins.item_id,
          itemName: ins.item_name,
          metric: `${ins.current_threshold} → ${ins.suggested_threshold}`,
          badgeClass: 'badge-low',
          badgeLabel: 'Adjust Threshold',
          recommendation: ins.message,
          suggestedThreshold: ins.suggested_threshold,
          actionType: 'apply'
        });
      }
    }
    return rows;
  }, [insights]);

  let auditClass = 'audit-box';
  let auditMessage = 'Click Verify Ledger to run a full SHA-256 chain check.';
  if (auditLoading) {
    auditMessage = 'Verifying SHA-256 hash chain...';
  } else if (auditResult) {
    if (auditResult.valid) {
      auditClass = 'audit-box valid';
      auditMessage = `VERIFIED: ${auditResult.checked_count} transaction records checked. Chain head: ${auditResult.latest_hash}`;
    } else {
      auditClass = 'audit-box invalid';
      auditMessage = `TAMPER ALERT: Chain broken at record #${auditResult.tampered_record_id} (${auditResult.reason}).`;
    }
  }

  return (
    <section id="view-analytics" className="view">
      {/* Top Grid: Demand Forecast Chart + Summary & Audit Ledger */}
      <div className="analytics-grid">
        <div className="card">
          <div className="card-head">
            <div>
              <h3 className="card-title">14-Day Demand &amp; Depletion Forecast</h3>
              <div className="chart-legend">
                <span className="legend-item">
                  <span className="legend-swatch swatch-primary" />
                  <span>Projected Stock</span>
                </span>
                <span className="legend-item">
                  <span className="legend-swatch swatch-secondary" />
                  <span>Reorder Threshold</span>
                </span>
              </div>
            </div>

            <select
              id="forecast-item-select"
              className="inv-select"
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
            width={720}
            height={250}
            theme={theme}
          />
        </div>

        <div className="dash-col">
          <div className="card">
            <div className="card-head">
              <h3 className="card-title">Portfolio Health</h3>
              {summary && (
                <span className="badge badge-ok tabular-nums">{`${summary.health_score}% Score`}</span>
              )}
            </div>
            {summary ? (
              <div className="list-stack">
                <div className="compact-row">
                  <span className="muted-text">Total Active SKUs</span>
                  <strong className="tabular-nums">{summary.total_items}</strong>
                </div>
                <div className="compact-row">
                  <span className="muted-text">Low / Out of Stock</span>
                  <strong className="tabular-nums">
                    {`${summary.low_stock} low · ${summary.out_of_stock} out`}
                  </strong>
                </div>
                <div className="compact-row">
                  <span className="muted-text">Total Valuation</span>
                  <strong className="tabular-nums">{formatMoney(summary.total_value)}</strong>
                </div>
              </div>
            ) : (
              <p className="muted-text">Loading summary metrics…</p>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h3 className="card-title">Cryptographic Audit Ledger</h3>
              <button
                id="btn-verify-chain"
                type="button"
                className="btn btn-primary btn-sm"
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
        </div>
      </div>

      {/* Structured Operational Table: AI Demand Predictions & Reorder Recommendations */}
      <div className="card">
        <div className="card-head">
          <h3 className="card-title">AI Demand Predictions &amp; Reorder Recommendations</h3>
          <span className="muted-text tabular-nums">{`${recommendationRows.length} recommendation(s)`}</span>
        </div>

        {recommendationRows.length === 0 ? (
          <p className="muted-text">
            No critical depletion alerts or threshold adjustments recommended at this time.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Status / Action</th>
                  <th>Telemetry</th>
                  <th>Recommendation</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {recommendationRows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <strong>{row.itemName}</strong>
                    </td>
                    <td>
                      <span className={`badge ${row.badgeClass}`}>{row.badgeLabel}</span>
                    </td>
                    <td>{row.metric}</td>
                    <td>{row.recommendation}</td>
                    <td>
                      {row.actionType === 'apply' ? (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => onApplyThreshold(row.itemId, row.suggestedThreshold)}
                        >
                          {`Set ${row.suggestedThreshold}`}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => onInspectItem(row.itemId)}
                        >
                          Inspect
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
