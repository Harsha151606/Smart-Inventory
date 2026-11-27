import { useMemo, useState } from 'react';
import ForecastChart from './ForecastChart.jsx';
import { formatMoney, statusLabel, statusOf } from '../utils/format.js';

export default function DashboardView({
  items,
  categories,
  insights,
  transactions,
  loading,
  theme,
  onAddStock,
  onSelectItem
}) {
  const [period, setPeriod] = useState('weekly');

  const totalUnits = useMemo(
    () => items.reduce((sum, i) => sum + Number(i.quantity || 0), 0),
    [items]
  );
  const totalValue = useMemo(
    () => items.reduce((sum, i) => sum + Number(i.quantity || 0) * Number(i.unit_price || 0), 0),
    [items]
  );
  const lowAlertItems = useMemo(
    () => items.filter((i) => Number(i.quantity || 0) <= Number(i.threshold || 0)),
    [items]
  );
  const outCount = useMemo(
    () => lowAlertItems.filter((i) => Number(i.quantity || 0) === 0).length,
    [lowAlertItems]
  );

  const netTxnDelta = useMemo(
    () => (transactions || []).reduce((sum, t) => sum + Number(t.quantity_change || 0), 0),
    [transactions]
  );

  const summary = (insights || []).find((x) => x.type === 'summary');
  const healthScore = summary ? summary.health_score : 100;

  const operationalSeries = useMemo(() => {
    const baseItems = items.slice(0, 8);
    if (period === 'daily') {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      return days.map((label, idx) => {
        const it = baseItems[idx % Math.max(1, baseItems.length)];
        const txSlice = (transactions || []).filter((_, tIdx) => tIdx % 7 === idx);
        const moved = txSlice.reduce((s, t) => s + Math.abs(t.quantity_change || 0), 0);
        return {
          label,
          primary: moved || (it ? Number(it.quantity || 0) : 0),
          secondary: it ? Number(it.threshold || 0) : 5,
          primaryLabel: 'Units Tracked',
          secondaryLabel: 'Reorder Baseline'
        };
      });
    }
    if (period === 'monthly') {
      const catSource = categories.length
        ? categories.slice(0, 6)
        : [{ id: 0, name: 'All Stock' }];
      return catSource.map((c) => {
        const zoneItems = c.id
          ? items.filter((i) => i.category_id === c.id)
          : items;
        return {
          label: c.name.slice(0, 10),
          primary: zoneItems.reduce((s, i) => s + Number(i.quantity || 0), 0),
          secondary: zoneItems.reduce((s, i) => s + Number(i.threshold || 0), 0),
          primaryLabel: 'On-Hand Units',
          secondaryLabel: 'Min Threshold'
        };
      });
    }
    // Weekly default: top items stock vs threshold comparison
    const list = baseItems.length ? baseItems : [{ name: 'No Data', quantity: 0, threshold: 0 }];
    return list.map((it) => ({
      label: it.name.length > 10 ? `${it.name.slice(0, 9)}…` : it.name,
      primary: Number(it.quantity || 0),
      secondary: Number(it.threshold || 0),
      primaryLabel: 'Current Stock',
      secondaryLabel: 'Threshold'
    }));
  }, [period, items, categories, transactions]);

  const topMovingItems = useMemo(() => {
    const map = new Map();
    for (const t of transactions || []) {
      const prev = map.get(t.item_id) || {
        id: t.item_id,
        name: t.item_name || `Item #${t.item_id}`,
        moves: 0,
        volume: 0
      };
      prev.moves += 1;
      prev.volume += Math.abs(Number(t.quantity_change || 0));
      map.set(t.item_id, prev);
    }
    const ranked = [...map.values()].sort((a, b) => b.volume - a.volume).slice(0, 4);
    if (ranked.length > 0) return ranked;
    return [...items]
      .sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0))
      .slice(0, 4)
      .map((i) => ({
        id: i.id,
        name: i.name,
        moves: 1,
        volume: Number(i.quantity || 0)
      }));
  }, [transactions, items]);

  const categoryCapacity = useMemo(() => {
    const catList = categories.length ? categories : [];
    const groups = catList.map((cat) => {
      const catItems = items.filter((i) => i.category_id === cat.id);
      const total = catItems.length;
      const healthyCount = catItems.filter((i) => Number(i.quantity) > Number(i.threshold)).length;
      const constrainedCount = total - healthyCount;
      const greenPct = total > 0 ? Math.round((healthyCount / total) * 100) : 100;
      const orangePct = total > 0 ? 100 - greenPct : 0;
      const units = catItems.reduce((s, i) => s + Number(i.quantity || 0), 0);
      return {
        id: cat.id,
        name: cat.name,
        units,
        total,
        greenPct,
        orangePct,
        constrainedCount
      };
    });
    return groups.slice(0, 5);
  }, [categories, items]);

  return (
    <section id="view-dash" className="view">
      {/* Top Row: 3 Flat White KPI Cards */}
      <div className="kpi-grid-3">
        <div className="kpi-card">
          <div className="kpi-top-row">
            <span className="kpi-label">Total Inventory Value</span>
            <span className="trend-pill trend-up">Health {healthScore}%</span>
          </div>
          <div className="kpi-value">{formatMoney(totalValue)}</div>
          <div className="kpi-sub">
            {`${items.length} active SKUs tracked`}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top-row">
            <span className="kpi-label">Total Stock Units</span>
            <span className={`trend-pill ${netTxnDelta >= 0 ? 'trend-up' : 'trend-neutral'}`}>
              {netTxnDelta >= 0 ? `↑ +${netTxnDelta} net` : `↓ ${netTxnDelta} net`}
            </span>
          </div>
          <div className="kpi-value">{totalUnits.toLocaleString()}</div>
          <div className="kpi-sub">
            {`Across ${categories.length || 1} warehouse zones`}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top-row">
            <span className="kpi-label">Low Stock &amp; Critical Alerts</span>
            <span
              className={`trend-pill ${
                outCount > 0 ? 'trend-down' : lowAlertItems.length > 0 ? 'trend-warn' : 'trend-up'
              }`}
            >
              {outCount > 0
                ? `${outCount} Critical`
                : lowAlertItems.length > 0
                ? 'Attention'
                : 'Healthy'}
            </span>
          </div>
          <div className="kpi-value">{lowAlertItems.length}</div>
          <div className="kpi-sub">
            {`${outCount} out of stock · ${Math.max(0, lowAlertItems.length - outCount)} low stock`}
          </div>
        </div>
      </div>

      {/* Main Grid: Left Operational Chart + Alerts Table, Right Stacked Cards */}
      <div className="dash-split">
        <div className="dash-col">
          {/* Operational Chart Card */}
          <div className="card">
            <div className="card-head">
              <div>
                <h3 className="card-title">Stock Level vs Reorder Threshold</h3>
                <div className="chart-legend">
                  <span className="legend-item">
                    <span className="legend-swatch swatch-primary" />
                    <span>Stock / Primary</span>
                  </span>
                  <span className="legend-item">
                    <span className="legend-swatch swatch-secondary" />
                    <span>Threshold / Baseline</span>
                  </span>
                </div>
              </div>

              <div className="period-toggle" role="group" aria-label="Chart granularity">
                {['monthly', 'weekly', 'daily'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`period-pill ${period === p ? 'active' : ''}`}
                    onClick={() => setPeriod(p)}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {loading && !items.length ? (
              <div className="skeleton-card" />
            ) : (
              <ForecastChart
                series={operationalSeries}
                width={720}
                height={240}
                theme={theme}
              />
            )}
          </div>

          {/* Low Stock & Restock Alert Table */}
          <div className="card">
            <div className="card-head">
              <h3 className="card-title">Low Stock &amp; Restock Alerts</h3>
              <span className="muted-text tabular-nums">{`${lowAlertItems.length} item(s)`}</span>
            </div>

            {lowAlertItems.length === 0 ? (
              <p className="muted-text">All inventory items are currently above reorder thresholds.</p>
            ) : (
              <div className="table-wrap">
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th>Item Name</th>
                      <th>Category</th>
                      <th>Stock</th>
                      <th>Threshold</th>
                      <th>Unit Price</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowAlertItems.map((item) => {
                      const cls = statusOf(item);
                      return (
                        <tr
                          key={item.id}
                          className="clickable-row"
                          onClick={() => onSelectItem(item.id)}
                        >
                          <td>
                            <strong>{item.name}</strong>
                            <div className="muted-text">{item.sku || `SKU-#${item.id}`}</div>
                          </td>
                          <td>{item.category_name || 'Uncategorized'}</td>
                          <td>
                            <span className={`badge badge-${cls}`}>
                              {`${item.quantity} ${item.unit || 'pcs'} · ${statusLabel(cls)}`}
                            </span>
                          </td>
                          <td>{item.threshold}</td>
                          <td>{formatMoney(item.unit_price)}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                onAddStock(item);
                              }}
                            >
                              Add Stock
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Top Moving Items + Category Storage Capacity */}
        <div className="dash-col">
          <div className="card">
            <div className="card-head">
              <h3 className="card-title">Top Moving Items</h3>
              <span className="muted-text">Recent activity</span>
            </div>

            <div className="list-stack">
              {topMovingItems.length ? (
                topMovingItems.map((m) => (
                  <div key={m.id} className="compact-row">
                    <div>
                      <div className="compact-row-title">{m.name}</div>
                      <div className="compact-row-sub tabular-nums">{`${m.moves} log(s)`}</div>
                    </div>
                    <span className="badge badge-ok tabular-nums">{`${m.volume} units`}</span>
                  </div>
                ))
              ) : (
                <p className="muted-text">No movement data recorded yet.</p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3 className="card-title">Category Storage Capacity</h3>
              <span className="muted-text">Healthy vs Constrained</span>
            </div>

            <div className="list-stack">
              {categoryCapacity.length ? (
                categoryCapacity.map((c) => (
                  <div key={c.id} className="capacity-item">
                    <div className="capacity-header">
                      <span className="capacity-name">{c.name}</span>
                      <span className="capacity-pct">
                        {`${c.greenPct}% healthy · ${c.units} units`}
                      </span>
                    </div>
                    <svg
                      className="seg-bar-svg"
                      viewBox="0 0 100 8"
                      preserveAspectRatio="none"
                      aria-label={`${c.name}: ${c.greenPct}% healthy, ${c.orangePct}% constrained`}
                    >
                      <rect className="seg-track" x="0" y="0" width="100" height="8" rx="4" />
                      {c.greenPct > 0 && (
                        <rect className="seg-green" x="0" y="0" width={c.greenPct} height="8" />
                      )}
                      {c.orangePct > 0 && (
                        <rect
                          className="seg-orange"
                          x={c.greenPct}
                          y="0"
                          width={c.orangePct}
                          height="8"
                        />
                      )}
                    </svg>
                  </div>
                ))
              ) : (
                <p className="muted-text">No categories available.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
