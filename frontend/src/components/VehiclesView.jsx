const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'available', label: 'Available' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'service_needed', label: 'Service Needed' }
];

function vehicleBadgeInfo(status) {
  if (status === 'available') return { cls: 'badge-ok', label: 'Available' };
  if (status === 'assigned') return { cls: 'badge-assigned', label: 'Assigned' };
  return { cls: 'badge-out', label: 'Service Needed' };
}

function DeliveryVanSvg() {
  return (
    <svg
      className="van-graphic"
      viewBox="0 0 180 68"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Cargo Box */}
      <rect
        x="10"
        y="12"
        width="102"
        height="40"
        rx="6"
        className="van-body"
        strokeWidth="1.5"
      />
      {/* Side Panel Rib Lines */}
      <line x1="36" y1="18" x2="36" y2="44" className="van-detail" strokeWidth="1.5" />
      <line x1="62" y1="18" x2="62" y2="44" className="van-detail" strokeWidth="1.5" />
      <line x1="88" y1="18" x2="88" y2="44" className="van-detail" strokeWidth="1.5" />
      {/* Cab */}
      <path
        d="M112 20H141C144 20 146.5 21.6 147.8 24.2L157 40C157.8 41.5 158 43 158 45V52H112V20Z"
        className="van-cab"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Cab Window */}
      <path
        d="M119 25H139.5L146.5 37H119V25Z"
        className="van-window"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Chassis Bar */}
      <line x1="8" y1="52" x2="162" y2="52" className="van-chassis" strokeWidth="1.5" />
      {/* Wheels */}
      <circle cx="42" cy="54" r="10" className="van-wheel-outer" strokeWidth="1.5" />
      <circle cx="42" cy="54" r="4" className="van-wheel-hub" />
      <circle cx="136" cy="54" r="10" className="van-wheel-outer" strokeWidth="1.5" />
      <circle cx="136" cy="54" r="4" className="van-wheel-hub" />
    </svg>
  );
}

export default function VehiclesView({
  summary,
  vehicles,
  loading,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  onOpenAddVehicle,
  onEditVehicle,
  onQuickStatusChange,
  onDeleteVehicle
}) {
  const counts = summary || { total: 0, available: 0, assigned: 0, service_needed: 0 };

  return (
    <section id="view-vehicles" className="view">
      {/* Top Header */}
      <div className="section-header-row">
        <div>
          <h2 className="section-title">Vehicles</h2>
          <p className="muted-text">Fleet availability, cargo capacity, and maintenance status</p>
        </div>

        <button
          id="btn-add-vehicle"
          type="button"
          className="btn btn-primary"
          onClick={onOpenAddVehicle}
        >
          + Add Vehicle
        </button>
      </div>

      {/* 4 Flat White KPI Cards */}
      <div className="kpi-grid-4">
        <div className="kpi-card">
          <span className="kpi-label">All Vehicles</span>
          <div className="kpi-value">{counts.total}</div>
          <span className="kpi-sub">Total registered fleet</span>
        </div>

        <div className="kpi-card">
          <div className="kpi-top-row">
            <span className="kpi-label">Available to Assign</span>
            <span className="badge badge-ok">Ready</span>
          </div>
          <div className="kpi-value">{counts.available}</div>
          <span className="kpi-sub">Ready for dispatch</span>
        </div>

        <div className="kpi-card">
          <div className="kpi-top-row">
            <span className="kpi-label">Assigned to Order</span>
            <span className="badge badge-assigned">Active</span>
          </div>
          <div className="kpi-value">{counts.assigned}</div>
          <span className="kpi-sub">Currently on routes</span>
        </div>

        <div className="kpi-card">
          <div className="kpi-top-row">
            <span className="kpi-label">Service Needed</span>
            <span className="badge badge-out">Alert</span>
          </div>
          <div className="kpi-value">{counts.service_needed}</div>
          <span className="kpi-sub">Maintenance required</span>
        </div>
      </div>

      {/* Search Bar & Status Filter Pills */}
      <div className="inv-toolbar">
        <input
          id="vehicle-search-input"
          type="search"
          className="inv-search-input"
          placeholder="Search plate number, model, or cargo type…"
          aria-label="Search vehicles"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />

        <div className="chip-row chip-row-inline" role="group" aria-label="Filter vehicles by status">
          {STATUS_FILTERS.map((f) => (
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

      {/* 3-Column Responsive Grid */}
      {loading && !vehicles.length ? (
        <div className="vehicles-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton-card" />
          ))}
        </div>
      ) : !vehicles.length ? (
        <div className="empty-state">
          <h3>No matching vehicles</h3>
          <p>Adjust your search filters or register a new delivery vehicle.</p>
          <button type="button" className="btn btn-primary" onClick={onOpenAddVehicle}>
            + Add Vehicle
          </button>
        </div>
      ) : (
        <div className="vehicles-grid">
          {vehicles.map((v) => {
            const badge = vehicleBadgeInfo(v.status);
            const loadPct = Math.max(0, Math.min(100, Number(v.current_load_pct || 0)));
            return (
              <article key={v.id} className="card vehicle-card">
                <div className="vehicle-card-top">
                  <div>
                    <div className="vehicle-plate tabular-nums">{v.plate_number}</div>
                    <div className="muted-text tabular-nums">
                      {v.last_service_date
                        ? `Serviced ${new Date(v.last_service_date).toLocaleDateString()}`
                        : 'No service record'}
                    </div>
                  </div>
                  <span className={`badge ${badge.cls}`}>{badge.label}</span>
                </div>

                <div className="van-stage">
                  <DeliveryVanSvg />
                </div>

                <div className="vehicle-specs">
                  <div className="vehicle-spec-row">
                    <span className="muted-text">Cargo Model</span>
                    <strong>{v.model}</strong>
                  </div>
                  <div className="vehicle-spec-row">
                    <span className="muted-text">Cargo Type</span>
                    <span>{v.cargo_type}</span>
                  </div>
                  <div className="vehicle-spec-row">
                    <span className="muted-text">Capacity</span>
                    <strong className="tabular-nums">
                      {`${Number(v.capacity_cubic_m).toFixed(3)} m³`}
                    </strong>
                  </div>
                </div>

                {/* Slim Royal Blue Load Progress Bar */}
                <div className="vehicle-load-wrap">
                  <div className="capacity-header">
                    <span className="muted-text">Current Load</span>
                    <span className="capacity-pct">{`${loadPct}%`}</span>
                  </div>
                  <svg
                    className="load-bar-svg"
                    viewBox="0 0 100 6"
                    preserveAspectRatio="none"
                    aria-label={`Current load ${loadPct}%`}
                  >
                    <rect className="seg-track" x="0" y="0" width="100" height="6" rx="3" />
                    {loadPct > 0 && (
                      <rect className="load-bar-fill" x="0" y="0" width={loadPct} height="6" rx="3" />
                    )}
                  </svg>
                </div>

                {/* Quick Status & Edit Actions */}
                <div className="vehicle-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onEditVehicle(v)}
                  >
                    Edit
                  </button>

                  {v.status !== 'available' && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onQuickStatusChange(v.id, 'available')}
                    >
                      Mark Available
                    </button>
                  )}

                  {v.status !== 'service_needed' && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => onQuickStatusChange(v.id, 'service_needed')}
                    >
                      Flag Service
                    </button>
                  )}

                  {v.status !== 'assigned' && (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => onDeleteVehicle(v)}
                    >
                      Remove
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
