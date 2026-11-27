import { useEffect, useState } from 'react';
import { createDelivery } from '../api.js';

const DELIVERY_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'delivered', label: 'Delivered' }
];

function deliveryBadgeInfo(status) {
  if (status === 'delivered') return { cls: 'badge-ok', label: 'Delivered' };
  if (status === 'in_transit') return { cls: 'badge-assigned', label: 'In Transit' };
  if (status === 'delayed') return { cls: 'badge-out', label: 'Delayed' };
  return { cls: 'badge-low', label: 'Pending' };
}

export default function DeliveryView({
  deliveries,
  vehicles,
  items,
  loading,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onUpdateStatus,
  onDeliveryCreated,
  addToast
}) {
  const [selectedId, setSelectedId] = useState(null);
  const [advancing, setAdvancing] = useState(false);

  // Dispatch Order Modal state
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [vehicleId, setVehicleId] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [origin, setOrigin] = useState('Central Hub A');
  const [destination, setDestination] = useState('');
  const [dispatchError, setDispatchError] = useState('');
  const [dispatching, setDispatching] = useState(false);

  const availableVehicles = (vehicles || []).filter((v) => v.status === 'available');
  const inStockItems = (items || []).filter((i) => Number(i.quantity || 0) > 0);

  useEffect(() => {
    if (!deliveries.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !deliveries.some((d) => d.id === selectedId)) {
      setSelectedId(deliveries[0].id);
    }
  }, [deliveries, selectedId]);

  useEffect(() => {
    if (!dispatchOpen) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape' && !dispatching) setDispatchOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [dispatchOpen, dispatching]);

  const selectedDelivery = deliveries.find((d) => d.id === selectedId) || deliveries[0] || null;

  function openDispatchModal() {
    setDispatchError('');
    setVehicleId(availableVehicles[0] ? String(availableVehicles[0].id) : '');
    setItemId(inStockItems[0] ? String(inStockItems[0].id) : '');
    setQuantity('1');
    setOrigin('Central Hub A');
    setDestination('');
    setDispatchOpen(true);
  }

  async function handleDispatchSubmit(e) {
    e.preventDefault();
    setDispatchError('');

    const vId = Number(vehicleId);
    const iId = Number(itemId);
    const qty = Number.parseInt(quantity, 10);

    if (!vId) {
      setDispatchError('Select an available vehicle.');
      return;
    }
    if (!iId) {
      setDispatchError('Select an in-stock item.');
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      setDispatchError('Quantity must be at least 1.');
      return;
    }
    if (origin.trim().length < 2 || destination.trim().length < 2) {
      setDispatchError('Origin and destination are required.');
      return;
    }

    setDispatching(true);
    try {
      const created = await createDelivery({
        vehicle_id: vId,
        item_id: iId,
        quantity: qty,
        origin: origin.trim(),
        destination: destination.trim()
      });
      setDispatchOpen(false);
      setSelectedId(created.id);
      addToast(`Dispatched ${created.tracking_code} on ${created.plate_number}`);
      await onDeliveryCreated(created);
    } catch (err) {
      const msg = err.message || 'Failed to dispatch order';
      setDispatchError(msg);
      addToast(msg, 'error');
    } finally {
      setDispatching(false);
    }
  }

  async function handleAdvance(nextStatus) {
    if (!selectedDelivery) return;
    setAdvancing(true);
    try {
      await onUpdateStatus(selectedDelivery.id, nextStatus);
    } finally {
      setAdvancing(false);
    }
  }

  const timelineIndex =
    selectedDelivery?.status === 'delivered'
      ? 2
      : selectedDelivery?.status === 'in_transit' || selectedDelivery?.status === 'delayed'
      ? 1
      : 0;

  return (
    <section id="view-deliveries" className="view">
      {/* Top Header */}
      <div className="section-header-row">
        <div>
          <h2 className="section-title">Delivery Services</h2>
          <p className="muted-text">Track active shipments, route progress, and vehicle assignments</p>
        </div>

        <button
          id="btn-dispatch-order"
          type="button"
          className="btn btn-primary"
          onClick={openDispatchModal}
        >
          + Dispatch Order
        </button>
      </div>

      {/* Filters */}
      <div className="inv-toolbar">
        <input
          id="delivery-search-input"
          type="search"
          className="inv-search-input"
          placeholder="Search tracking code, plate, item, or route…"
          aria-label="Search deliveries"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />

        <div className="chip-row chip-row-inline" role="group" aria-label="Filter deliveries by status">
          {DELIVERY_FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              type="button"
              className={`chip ${statusFilter === f.value ? 'active' : ''}`}
              onClick={() => onStatusFilterChange(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Two-Column Operational Layout */}
      <div className="delivery-split">
        {/* Left Column: Shipment Cards */}
        <div className="card">
          <div className="card-head">
            <h3 className="card-title">Shipments</h3>
            <span className="muted-text tabular-nums">{`${deliveries.length} order(s)`}</span>
          </div>

          {loading && !deliveries.length ? (
            <div className="list-stack">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="skeleton-card" />
              ))}
            </div>
          ) : !deliveries.length ? (
            <div className="empty-state">
              <h3>No shipments found</h3>
              <p>Dispatch a new order or adjust status filters.</p>
              <button type="button" className="btn btn-primary" onClick={openDispatchModal}>
                + Dispatch Order
              </button>
            </div>
          ) : (
            <div className="list-stack">
              {deliveries.map((d) => {
                const badge = deliveryBadgeInfo(d.status);
                const isSelected = selectedDelivery?.id === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`shipment-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedId(d.id)}
                  >
                    <div className="shipment-card-top">
                      <span className="shipment-code tabular-nums">{d.tracking_code}</span>
                      <span className={`badge ${badge.cls}`}>{badge.label}</span>
                    </div>

                    <div className="shipment-item-row">
                      <strong>{d.item_name}</strong>
                      <span className="tabular-nums">{`${d.quantity} ${d.item_unit || 'pcs'}`}</span>
                    </div>

                    <div className="shipment-meta-row">
                      <span className="muted-text tabular-nums">{`Plate: ${d.plate_number}`}</span>
                      <span className="muted-text">{`${d.origin} → ${d.destination}`}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Selected Shipment Detail Panel */}
        <div className="card delivery-detail-panel">
          {!selectedDelivery ? (
            <div className="empty-state">
              <h3>Select a shipment</h3>
              <p>Choose a shipment on the left to inspect route progress and vehicle assignment.</p>
            </div>
          ) : (
            <>
              <div className="inspector-header">
                <div>
                  <div className="shipment-code tabular-nums">{selectedDelivery.tracking_code}</div>
                  <h3 className="inspector-title">
                    {`${selectedDelivery.item_name} (${selectedDelivery.quantity} ${selectedDelivery.item_unit || 'pcs'})`}
                  </h3>
                </div>
                <span className={`badge ${deliveryBadgeInfo(selectedDelivery.status).cls}`}>
                  {deliveryBadgeInfo(selectedDelivery.status).label}
                </span>
              </div>

              {/* Assigned Vehicle Summary */}
              <div className="detail-subcard">
                <div className="card-head mb-8">
                  <span className="card-title">Assigned Vehicle</span>
                  <span className="badge badge-assigned tabular-nums">
                    {selectedDelivery.plate_number}
                  </span>
                </div>
                <div className="vehicle-specs">
                  <div className="vehicle-spec-row">
                    <span className="muted-text">Model &amp; Type</span>
                    <strong>{`${selectedDelivery.vehicle_model} · ${selectedDelivery.vehicle_cargo_type}`}</strong>
                  </div>
                  <div className="vehicle-spec-row">
                    <span className="muted-text">Capacity</span>
                    <span className="tabular-nums">
                      {selectedDelivery.capacity_cubic_m != null
                        ? `${Number(selectedDelivery.capacity_cubic_m).toFixed(3)} m³`
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Route Origin & Destination */}
              <div className="detail-subcard">
                <div className="card-head mb-8">
                  <span className="card-title">Route &amp; Schedule</span>
                  <span className="muted-text tabular-nums">
                    {selectedDelivery.eta
                      ? `ETA ${new Date(selectedDelivery.eta).toLocaleString()}`
                      : 'ETA Pending'}
                  </span>
                </div>
                <div className="route-pair">
                  <div>
                    <div className="muted-text">Origin</div>
                    <strong>{selectedDelivery.origin}</strong>
                  </div>
                  <span className="route-arrow" aria-hidden="true">→</span>
                  <div>
                    <div className="muted-text">Destination</div>
                    <strong>{selectedDelivery.destination}</strong>
                  </div>
                </div>
              </div>

              {/* Step-by-Step Status Timeline */}
              <div className="detail-subcard">
                <div className="card-head mb-8">
                  <span className="card-title">Delivery Timeline</span>
                  <span className="muted-text tabular-nums">
                    {`Updated ${new Date(selectedDelivery.updated_at).toLocaleString()}`}
                  </span>
                </div>

                <div className="status-timeline" role="list">
                  {[
                    { key: 'pending', label: 'Pending', sub: 'Stock allocated' },
                    {
                      key: 'in_transit',
                      label: selectedDelivery.status === 'delayed' ? 'Delayed' : 'In Transit',
                      sub: 'En route to destination'
                    },
                    { key: 'delivered', label: 'Delivered', sub: 'Vehicle released' }
                  ].map((step, idx) => {
                    const reached = timelineIndex >= idx;
                    const isDelayedStep = idx === 1 && selectedDelivery.status === 'delayed';
                    return (
                      <div
                        key={step.key}
                        role="listitem"
                        className={`timeline-step ${reached ? 'reached' : ''} ${
                          isDelayedStep ? 'delayed' : ''
                        }`}
                      >
                        <span className="timeline-dot" aria-hidden="true" />
                        <div>
                          <div className="timeline-label">{step.label}</div>
                          <div className="muted-text">{step.sub}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* One-Click Dispatch / Complete Actions */}
              {selectedDelivery.status !== 'delivered' && (
                <div className="form-actions">
                  {(selectedDelivery.status === 'pending' ||
                    selectedDelivery.status === 'delayed') && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={advancing}
                      onClick={() => handleAdvance('in_transit')}
                    >
                      {advancing ? 'Updating...' : 'Start In Transit'}
                    </button>
                  )}

                  {selectedDelivery.status !== 'delayed' && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={advancing}
                      onClick={() => handleAdvance('delayed')}
                    >
                      Mark Delayed
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={advancing}
                    onClick={() => handleAdvance('delivered')}
                  >
                    {advancing ? 'Completing...' : 'Complete Delivery'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Dispatch Order Modal */}
      {dispatchOpen && (
        <div
          id="dispatch-modal-overlay"
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dispatch-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !dispatching) setDispatchOpen(false);
          }}
        >
          <div className="modal-box">
            <div className="modal-header">
              <h3 id="dispatch-modal-title" className="modal-title">Dispatch Delivery Order</h3>
              <button
                type="button"
                className="modal-close-btn"
                aria-label="Close dispatch dialog"
                disabled={dispatching}
                onClick={() => setDispatchOpen(false)}
              >
                ×
              </button>
            </div>

            <form className="form-stack" onSubmit={handleDispatchSubmit} noValidate>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="d-vehicle">Available Vehicle *</label>
                  <select
                    id="d-vehicle"
                    value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}
                  >
                    <option value="">Select available vehicle…</option>
                    {availableVehicles.map((v) => (
                      <option key={v.id} value={String(v.id)}>
                        {`${v.plate_number} · ${v.model} (${Number(v.capacity_cubic_m).toFixed(1)} m³)`}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label htmlFor="d-item">In-Stock Item *</label>
                  <select
                    id="d-item"
                    value={itemId}
                    onChange={(e) => setItemId(e.target.value)}
                  >
                    <option value="">Select item…</option>
                    {inStockItems.map((it) => (
                      <option key={it.id} value={String(it.id)}>
                        {`${it.name} (${it.quantity} ${it.unit || 'pcs'} avail.)`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid-2">
                <div className="field">
                  <label htmlFor="d-qty">Dispatch Quantity *</label>
                  <input
                    id="d-qty"
                    type="number"
                    min={1}
                    max={1000000}
                    required
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="d-origin">Origin Hub *</label>
                  <input
                    id="d-origin"
                    type="text"
                    required
                    maxLength={160}
                    value={origin}
                    onChange={(e) => setOrigin(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="d-dest">Destination *</label>
                <input
                  id="d-dest"
                  type="text"
                  required
                  maxLength={160}
                  placeholder="e.g., Jakarta North Depot"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                />
              </div>

              {dispatchError && (
                <p className="form-error" role="alert">
                  {dispatchError}
                </p>
              )}

              <div className="form-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={dispatching || !availableVehicles.length || !inStockItems.length}
                >
                  {dispatching ? 'Dispatching...' : 'Confirm Dispatch'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={dispatching}
                  onClick={() => setDispatchOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
