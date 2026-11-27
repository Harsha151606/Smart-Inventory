import { useEffect, useState } from 'react';
import ForecastChart from './ForecastChart.jsx';
import { formatMoney, statusLabel, statusOf } from '../utils/format.js';

export default function ItemDetailView({
  item,
  user,
  loading,
  theme,
  onClose,
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
      <aside id="view-detail" className="inspector-panel" aria-label="Item Inspector">
        <div className="inspector-header">
          <div>
            <h3 className="inspector-title">Loading Item…</h3>
            <p className="muted-text">Fetching telemetry and audit logs</p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            aria-label="Close inspector"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="skeleton-card" />
      </aside>
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
    <aside id="view-detail" className="inspector-panel" aria-label="Item Inspector">
      <div className="inspector-header">
        <div>
          <h3 className="inspector-title">{item.name}</h3>
          <p className="muted-text tabular-nums">
            {`${item.category_name || 'Uncategorized'} · ${item.sku || `SKU-#${item.id}`}`}
          </p>
        </div>
        <div className="qty-controls">
          <span className={`badge badge-${cls}`}>{statusLabel(cls)}</span>
          <button
            type="button"
            className="modal-close-btn"
            aria-label="Close inspector"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>

      {item.description && <p className="muted-text">{item.description}</p>}

      {/* Key Metrics */}
      <div className="inspector-metrics">
        <div className="inspector-stat">
          <div className="inspector-stat-label">On Hand</div>
          <div className="inspector-stat-val">{`${item.quantity} ${item.unit || 'pcs'}`}</div>
        </div>
        <div className="inspector-stat">
          <div className="inspector-stat-label">Threshold</div>
          <div className="inspector-stat-val">{item.threshold}</div>
        </div>
        <div className="inspector-stat">
          <div className="inspector-stat-label">Valuation</div>
          <div className="inspector-stat-val">
            {formatMoney(item.quantity * Number(item.unit_price || 0))}
          </div>
        </div>
      </div>

      {/* Inline Stock Adjustment Controls */}
      <div className="compact-row">
        <div>
          <div className="compact-row-title">Quick Stock Adjustment</div>
          <div className="compact-row-sub tabular-nums">
            {`${formatMoney(item.unit_price)} / ${item.unit || 'pcs'}`}
          </div>
        </div>
        <div className="qty-controls">
          <button
            type="button"
            className="qty-btn"
            aria-label={`Consume 1 ${item.name}`}
            disabled={item.quantity === 0}
            onClick={() => onQuickUpdate(item, 'dec')}
          >
            -
          </button>
          <span className="qty-num">{item.quantity}</span>
          <button
            type="button"
            className="qty-btn"
            aria-label={`Restock 1 ${item.name}`}
            onClick={() => onQuickUpdate(item, 'inc')}
          >
            +
          </button>
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={() => onEdit(item)}>
          Edit Item
        </button>
        {isAdmin && (
          <button type="button" className="btn btn-danger" onClick={() => setConfirmOpen(true)}>
            Delete
          </button>
        )}
      </div>

      {/* AI Reorder Forecast (from aiEngine.js) */}
      <div>
        <div className="card-head mb-8">
          <span className="card-title">AI Reorder Forecast</span>
          {item.suggested_threshold != null && (
            <button
              type="button"
              className="btn-link tabular-nums"
              onClick={() => onApplyThreshold(item.id, item.suggested_threshold)}
            >
              {`Apply Suggested (${item.suggested_threshold})`}
            </button>
          )}
        </div>

        <div className="list-stack mb-12">
          <div className="compact-row">
            <span className="muted-text">Daily consumption rate</span>
            <strong className="tabular-nums">{`${item.prediction?.daily_rate ?? 0} / day`}</strong>
          </div>
          <div className="compact-row">
            <span className="muted-text">Days until empty</span>
            <strong className="tabular-nums">
              {item.prediction?.days_until_empty != null
                ? `${item.prediction.days_until_empty} days`
                : 'Stable'}
            </strong>
          </div>
          <div className="compact-row">
            <span className="muted-text">Anomalies detected (60d)</span>
            <strong className="tabular-nums">{String((item.anomalies || []).length)}</strong>
          </div>
        </div>

        <ForecastChart
          forecast={item.forecast || []}
          threshold={item.threshold}
          width={420}
          height={180}
          theme={theme}
        />
      </div>

      {/* HMAC-Signed QR Code Preview */}
      <div>
        <div className="card-head mb-8">
          <span className="card-title">HMAC-Signed QR Label</span>
          <button type="button" className="btn-link" onClick={handleCopyQr}>
            Copy Payload
          </button>
        </div>
        <div className="qr-row">
          {item.qr_image ? (
            <img
              className="qr-preview-sm"
              alt={`QR code for ${item.name}`}
              src={`data:image/png;base64,${item.qr_image}`}
            />
          ) : (
            <span className="muted-text">QR unavailable</span>
          )}
          <div className="code-block">{item.qr_data || 'No QR data'}</div>
        </div>
      </div>

      {/* Recent Cryptographic Audit Trail */}
      <div>
        <div className="card-head mb-8">
          <span className="card-title">Recent Audit Trail</span>
        </div>
        <div className="list-stack">
          {(item.transactions || []).length ? (
            item.transactions.slice(0, 5).map((t) => (
              <div key={t.id} className="compact-row">
                <div>
                  <div className="compact-row-title tabular-nums">
                    {`${t.action_type} (${t.previous_quantity} → ${t.new_quantity})`}
                  </div>
                  <div className="compact-row-sub tabular-nums">
                    {`${t.actor_name || 'system'} · ${new Date(t.created_at).toLocaleString()}`}
                  </div>
                </div>
                <span className="hash-pill" title={t.record_hash}>
                  #{(t.record_hash || '').slice(0, 8)}
                </span>
              </div>
            ))
          ) : (
            <p className="muted-text">No transactions recorded yet.</p>
          )}
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
              <h3 id="confirm-delete-title" className="modal-title">Delete Item</h3>
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
                {`Permanently archive "${item.name}" and preserve its SHA-256 transaction ledger?`}
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
    </aside>
  );
}
