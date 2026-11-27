import { formatMoney } from '../utils/format.js';

export default function DashboardView({
  items,
  insights,
  transactions,
  loading,
  onApplyThreshold,
  onOpenAnalytics,
  onVerifyChain
}) {
  const total = items.length;
  const low = items.filter((i) => i.quantity <= i.threshold && i.quantity > 0).length;
  const out = items.filter((i) => i.quantity === 0).length;
  const totalValue = items.reduce((s, i) => s + i.quantity * Number(i.unit_price || 0), 0);
  const summary = (insights || []).find((x) => x.type === 'summary');
  const health = summary ? summary.health_score : 100;

  const kpis = [
    {
      label: 'Total SKUs',
      value: String(total),
      sub: `Health Score: ${health}%`,
      cls: 'text-accent'
    },
    {
      label: 'Low Stock Alerts',
      value: String(low),
      sub: 'At or below threshold',
      cls: 'text-warn'
    },
    {
      label: 'Out of Stock',
      value: String(out),
      sub: 'Immediate reorder needed',
      cls: 'text-danger'
    },
    {
      label: 'Inventory Value',
      value: formatMoney(totalValue),
      sub: 'Current on-hand valuation',
      cls: 'text-ok'
    }
  ];

  return (
    <section id="view-dash" className="view">
      <div className="kpi-grid">
        {kpis.map((k) => (
          <div key={k.label} className="kpi-card">
            <div className="kpi-label">{k.label}</div>
            <div className={`kpi-value tabular-nums ${k.cls}`}>{k.value}</div>
            <div className="kpi-sub tabular-nums">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        <div className="panel">
          <div className="panel-head">
            <h3>AI Insights &amp; Recommendations</h3>
            <button type="button" className="btn-link" onClick={onOpenAnalytics}>
              Full report
            </button>
          </div>

          <div className="stack">
            {loading && !insights.length ? (
              <p className="muted-text">Loading AI insights...</p>
            ) : insights.length ? (
              insights.map((ins, idx) => {
                if (ins.type === 'summary') {
                  const barCls =
                    ins.health_score >= 70
                      ? 'progress-ok'
                      : ins.health_score >= 40
                      ? 'progress-low'
                      : 'progress-out';
                  return (
                    <div key={`sum-${idx}`} className="insight-item">
                      <div className="label-row">
                        <strong>Inventory Health Score</strong>
                        <strong className="text-accent tabular-nums">{ins.health_score}%</strong>
                      </div>
                      <progress
                        className={`progress-bar ${barCls}`}
                        max={100}
                        value={ins.health_score}
                      />
                    </div>
                  );
                }

                if (ins.type === 'critical_stock') {
                  const names = (ins.items || [])
                    .map((x) => `${x.name} (${x.quantity === 0 ? 'OUT' : `~${x.days ?? '?'}d`})`)
                    .join(', ');
                  return (
                    <div key={`crit-${idx}`} className="insight-item critical">
                      <strong className="text-danger">{ins.message}</strong>
                      <p className="muted-text tabular-nums">{names}</p>
                    </div>
                  );
                }

                if (ins.type === 'threshold_adjustment') {
                  return (
                    <div key={`thresh-${ins.item_id}-${idx}`} className="insight-item">
                      <div className="label-row">
                        <strong className="text-warn">Threshold Suggestion</strong>
                        <button
                          type="button"
                          className="btn-link tabular-nums"
                          onClick={() => onApplyThreshold(ins.item_id, ins.suggested_threshold)}
                        >
                          Apply ({ins.suggested_threshold})
                        </button>
                      </div>
                      <p className="muted-text">{ins.message}</p>
                    </div>
                  );
                }

                return null;
              })
            ) : (
              <p className="muted-text">No AI insights yet.</p>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Recent Hash-Chained Activity</h3>
            <button type="button" className="btn-link" onClick={onVerifyChain}>
              Verify chain
            </button>
          </div>

          <div className="stack">
            {loading && !transactions.length ? (
              <p className="muted-text">Loading recent transactions...</p>
            ) : transactions.length ? (
              transactions.map((t) => {
                const sign = t.quantity_change > 0 ? `+${t.quantity_change}` : String(t.quantity_change);
                const deltaCls = t.quantity_change >= 0 ? 'text-ok' : 'text-danger';
                return (
                  <div key={t.id} className="activity-row">
                    <div>
                      <div>{t.item_name || `Item #${t.item_id}`}</div>
                      <div className="muted-text">
                        {`${t.action_type} · ${t.actor_name || 'system'} · ${new Date(t.created_at).toLocaleDateString()}`}
                      </div>
                    </div>
                    <div className="qty-controls">
                      <span className={`tabular-nums ${deltaCls}`}>{sign}</span>
                      <span className="hash-pill" title={t.record_hash}>
                        #{(t.record_hash || '').slice(0, 8)}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="muted-text">No stock transactions recorded yet.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
