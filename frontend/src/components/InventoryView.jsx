import { formatMoney, statusLabel, statusOf } from '../utils/format.js';

const STATUS_CHIPS = [
  { value: '', label: 'All' },
  { value: 'ok', label: 'In Stock' },
  { value: 'low', label: 'Low Stock' },
  { value: 'out', label: 'Out of Stock' }
];

export default function InventoryView({
  items,
  categories,
  loading,
  search,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  statusFilter,
  onStatusFilterChange,
  sortBy,
  onSortChange,
  layout,
  onLayoutChange,
  isMobile,
  onQuickUpdate,
  onSelectItem,
  onOpenAddItem
}) {
  const effectiveLayout = isMobile ? 'cards' : layout;

  function renderQtyControls(item) {
    return (
      <div className="qty-controls">
        <button
          type="button"
          className="qty-btn"
          aria-label={`Decrease ${item.name}`}
          disabled={item.quantity === 0}
          onClick={(e) => {
            e.stopPropagation();
            onQuickUpdate(item, 'dec');
          }}
        >
          -
        </button>
        <span className="qty-num tabular-nums">{item.quantity}</span>
        <button
          type="button"
          className="qty-btn"
          aria-label={`Increase ${item.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onQuickUpdate(item, 'inc');
          }}
        >
          +
        </button>
      </div>
    );
  }

  return (
    <section id="view-inv" className="view">
      <div className="toolbar">
        <input
          id="search-input"
          type="search"
          className="input search-input"
          placeholder="Search by name, SKU, or description..."
          aria-label="Search inventory"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />

        <select
          id="filter-cat"
          className="select"
          aria-label="Filter by category"
          value={categoryFilter}
          onChange={(e) => onCategoryFilterChange(e.target.value)}
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {`${c.name} (${c.item_count})`}
            </option>
          ))}
        </select>

        <select
          id="sort-select"
          className="select"
          aria-label="Sort items"
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value)}
        >
          <option value="name">Sort: Name (A-Z)</option>
          <option value="quantity">Sort: Lowest Stock</option>
          <option value="value">Sort: Highest Value</option>
          <option value="recent">Sort: Recently Updated</option>
        </select>

        <div className="view-toggle" role="group" aria-label="Layout view">
          <button
            id="btn-layout-cards"
            type="button"
            className={`toggle-btn ${layout === 'cards' ? 'active' : ''}`}
            onClick={() => onLayoutChange('cards')}
          >
            Cards
          </button>
          <button
            id="btn-layout-table"
            type="button"
            className={`toggle-btn ${layout === 'table' ? 'active' : ''}`}
            onClick={() => onLayoutChange('table')}
          >
            Table
          </button>
        </div>
      </div>

      <div id="status-chips" className="chip-row" role="group" aria-label="Filter by stock status">
        {STATUS_CHIPS.map((chip) => (
          <button
            key={chip.value || 'all'}
            type="button"
            className={`chip ${statusFilter === chip.value ? 'active' : ''}`}
            onClick={() => onStatusFilterChange(chip.value)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {loading && !items.length ? (
        <div className="items-grid" aria-label="Loading inventory">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton-card" />
          ))}
        </div>
      ) : !items.length ? (
        <div id="empty-state" className="empty-state">
          <h3>No matching inventory items</h3>
          <p>Adjust your search filters or create a new SKU.</p>
          <button type="button" className="btn btn-primary" onClick={onOpenAddItem}>
            Add New Item
          </button>
        </div>
      ) : effectiveLayout === 'table' ? (
        <div className="table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th>Status</th>
                <th>Unit Price</th>
                <th>Total Value</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const cls = statusOf(item);
                return (
                  <tr key={item.id} onClick={() => onSelectItem(item.id)}>
                    <td>
                      <strong>{item.name}</strong>
                      <div className="item-meta">{item.sku || `#${item.id}`}</div>
                    </td>
                    <td>{item.category_name || 'Uncategorized'}</td>
                    <td>
                      <span className={`badge badge-${cls}`}>{statusLabel(cls)}</span>
                    </td>
                    <td className="tabular-nums">{`${formatMoney(item.unit_price)} / ${item.unit || 'pcs'}`}</td>
                    <td className="tabular-nums">
                      {formatMoney(item.quantity * Number(item.unit_price || 0))}
                    </td>
                    <td>{renderQtyControls(item)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="items-grid">
          {items.map((item) => {
            const cls = statusOf(item);
            const pct =
              item.threshold > 0
                ? Math.min(100, Math.round((item.quantity / item.threshold) * 100))
                : 100;
            return (
              <article
                key={item.id}
                className="item-card"
                onClick={() => onSelectItem(item.id)}
              >
                <div className="item-top">
                  <div>
                    <div className="item-name">{item.name}</div>
                    <div className="item-meta">
                      {`${item.category_name || 'Uncategorized'} · ${item.sku || `SKU-#${item.id}`}`}
                    </div>
                  </div>
                  <span className={`badge badge-${cls}`}>{statusLabel(cls)}</span>
                </div>

                <div className="label-row">
                  <span className="muted-text tabular-nums">
                    {`${item.quantity} ${item.unit || 'pcs'} (min ${item.threshold})`}
                  </span>
                  <span className="muted-text tabular-nums">
                    {formatMoney(item.quantity * Number(item.unit_price || 0))}
                  </span>
                </div>

                <progress className={`progress-bar progress-${cls}`} max={100} value={pct} />

                <div className="item-bottom">
                  <span className="muted-text tabular-nums">
                    {`${formatMoney(item.unit_price)} / ${item.unit || 'pcs'}`}
                  </span>
                  {renderQtyControls(item)}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
