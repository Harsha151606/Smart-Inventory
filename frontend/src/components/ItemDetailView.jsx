import { useEffect, useState } from 'react';
import ForecastChart from './ForecastChart.jsx';
import { formatMoney, statusLabel, statusOf } from '../utils/format.js';

export default function ItemDetailView({
  item,
  user,
  loading,
  theme,
  onBack,
  onQuickUpdate,
  onEdit,
  onDelete,
  onApplyThreshold,
  addToast
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!confirmOpen) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') setConfirmOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [confirmOpen]);

  if (loading && !item) {
    return (
      <section id="view-detail" className="view">
        <button type="button" className="btn btn-ghost mb-16" onClick={onBack}>
          &lt;- Back to Inventory
        </button>
        <div className="panel">
          <p className="muted-text">Loading item telemetry...</p>
        </div>
      </section>
    );
  }

  if (!item) return null;

  const cls = statusOf(item);
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';

  async function handleConfirmDelete() {
    setDeleting(true);
    try {
      await onDelete(item);
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  async function handleCopyQr() {
    try {
      await navigator.clipboard?.writeText(item.qr_data || '');
      addToast('Signed QR payload copied');
    } catch {
      addToast('Clipboard unavailable', 'warn');
    }
  }

  return (
    <section id="view-detail" className="view">
      <button type="button" className="btn btn-ghost mb-16" onClick={onBack}>
        &lt;- Back to Inventory
      </button>

      <div className="detail-grid">
        <div className="stack">
          <div className="panel">
            <div className="item-top">
              <div>
                <h3 className="page-title">{item.name}</h3>
                <p className="muted-text tabular-nums">
                  {`${item.category_name || 'Uncategorized'} · SKU: ${item.sku || 'N/A'} · ID #${item.id}`}
                </p>
              </div>
              <span className={`badge badge-${cls}`}>
                {`${item.quantity} ${item.unit || 'pcs'} · ${statusLabel(cls)}`}
              </span>
            </div>

            {item.description && <p className="muted-text mb-16">{item.description}</p>}

            <div className="grid-3 mb-16">
              <div className="kpi-card">
                <div className="kpi-label">Threshold</div>
                <div className="kpi-value tabular-nums text-warn">{String(item.threshold)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Unit Price</div>
                <div className="kpi-value tabular-nums text-accent">{formatMoney(item.unit_price)}</div>
              </div>
              <div className="kpi-card">
                <div className="kpi-label">Total Value</div>
                <div className="kpi-value tabular-nums text-ok">
                  {formatMoney(item.quantity * Number(item.unit_price || 0))}
                </div>
              </div>
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-danger"
                disabled={item.quantity === 0}
                onClick={() => onQuickUpdate(item, 'dec')}
              >
                -1 Consume
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onQuickUpdate(item, 'inc')}
              >
                +1 Restock
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => onEdit(item)}
              >
                Edit Item
              </button>
              {isAdmin && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setConfirmOpen(true)}
                >
                  Delete
                </button>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>14-Day Projected Stock Level</h3>
              {item.suggested_threshold != null && (
                <button
                  type="button"
                  className="btn-link tabular-nums"
                  onClick={() => onApplyThreshold(item.id, item.suggested_threshold)}
                >
                  {`AI Suggested Threshold: ${item.suggested_threshold}`}
                </button>
              )}
            </div>
            <ForecastChart
              forecast={item.forecast || []}
              threshold={item.threshold}
              width={640}
              height={220}
              theme={theme}
            />
          </div>

          <div className="panel">
            <h3 className="panel-title">Recent Cryptographic Audit Trail</h3>
            <div className="stack">
              {(item.transactions || []).length ? (
                item.transactions.map((t) => (
                  <div key={t.id} className="activity-row">
                    <div>
                      <strong className="tabular-nums">
                        {`${t.action_type} (${t.previous_quantity} -> ${t.new_quantity})`}
                      </strong>
                      <div className="muted-text">
                        {`${t.actor_name || 'system'} · ${new Date(t.created_at).toLocaleString()}`}
                      </div>
                    </div>
                    <span className="hash-pill" title={t.record_hash}>
                      #{(t.record_hash || '').slice(0, 10)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="muted-text">No transactions yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="panel">
            <h3 className="panel-title">HMAC-Signed QR Label</h3>
            {item.qr_image ? (
              <img
                className="qr-preview"
                alt={`QR code for ${item.name}`}
                src={`data:image/png;base64,${item.qr_image}`}
              />
            ) : (
              <p className="muted-text">QR unavailable</p>
            )}
            <div className="code-block mb-16">{item.qr_data || ''}</div>
            <button type="button" className="btn btn-secondary btn-full" onClick={handleCopyQr}>
              Copy Signed QR Payload
            </button>
          </div>

          <div className="panel">
            <h3 className="panel-title">AI Depletion Telemetry</h3>
            <div className="stack">
              <div className="activity-row">
                <span className="muted-text">Daily usage rate</span>
                <strong className="tabular-nums">{`${item.prediction?.daily_rate ?? 0} / day`}</strong>
              </div>
              <div className="activity-row">
                <span className="muted-text">Days until empty</span>
                <strong className="tabular-nums">
                  {item.prediction?.days_until_empty != null
                    ? `${item.prediction.days_until_empty} days`
                    : 'Stable'}
                </strong>
              </div>
              <div className="activity-row">
                <span className="muted-text">Anomalies detected (60d)</span>
                <strong className="tabular-nums">{String((item.anomalies || []).length)}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      {confirmOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deleting) setConfirmOpen(false);
          }}
        >
          <div className="modal-box">
            <div className="modal-header">
              <h3 id="confirm-delete-title" className="panel-title">Delete Item</h3>
              <button
                type="button"
                className="modal-close-btn"
                aria-label="Close confirmation dialog"
                disabled={deleting}
                onClick={() => setConfirmOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="form-stack">
              <p className="muted-text">
                {`Permanently delete "${item.name}" and its transaction history?`}
              </p>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={deleting}
                  onClick={handleConfirmDelete}
                >
                  {deleting ? 'Deleting...' : 'Delete Item'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={deleting}
                  onClick={() => setConfirmOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
