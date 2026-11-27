import { useMemo } from 'react';
import ItemDetailView from './ItemDetailView.jsx';
import { formatMoney, statusLabel, statusOf } from '../utils/format.js';

const STATUS_CHIPS = [
  { value: '', label: 'All Status' },
  { value: 'ok', label: 'In Stock' },
  { value: 'low', label: 'Low Stock' },
  { value: 'out', label: 'Out of Stock' }
];

function dotClassFor(cls) {
  if (cls === 'out') return 'dot-out';
  if (cls === 'low') return 'dot-low';
  return 'dot-in-stock';
}

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
  selectedItemId,
  detailItem,
  loadingDetail,
  user,
  theme,
  onSelectItem,
  onCloseInspector,
  onQuickUpdate,
  onOpenAddItem,
  onEditItem,
  onDeleteItem,
  onApplyThreshold,
  addToast
}) {
  const effectiveLayout = isMobile ? 'zones' : layout;

  const zoneGroups = useMemo(() => {
    const groups = [];
    const seenCatIds = new Set();

    const activeCategories = categoryFilter
      ? categories.filter((c) => String(c.id) === String(categoryFilter))
      : categories;

    for (const cat of activeCategories) {
      const catItems = items.filter((i) => i.category_id === cat.id);
      if (catItems.length > 0 || String(categoryFilter) === String(cat.id)) {
        seenCatIds.add(cat.id);
        groups.push({
          key: `cat-${cat.id}`,
          name: cat.name,
          items: catItems
        });
      }
    }

    const uncategorized = items.filter(
      (i) => i.category_id == null || !seenCatIds.has(i.category_id)
    );
    if (uncategorized.length > 0 && !categoryFilter) {
      groups.push({
        key: 'cat-none',
        name: 'General / Uncategorized Zone',
        items: uncategorized
      });
    }

    return groups;
  }, [items, categories, categoryFilter]);

  const showInspector = Boolean(selectedItemId && (detailItem || loadingDetail));

  return (
    <section id="view-inv" className="view">
      {/* Top Action & Filter Bar */}
      <div className="inv-toolbar">
        <div className="inv-toolbar-controls">
          <input
            id="search-input"
            type="search"
            className="inv-search-input"
            placeholder="Filter by name, SKU, or description..."
            aria-label="Search inventory"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />

          <select
            id="sort-select"
            className="inv-select"
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
              className={`toggle-btn ${layout === 'zones' ? 'active' : ''}`}
              onClick={() => onLayoutChange('zones')}
            >
              Zone Grid
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

        <button
          id="btn-quick-add"
          type="button"
          className="btn btn-primary"
          onClick={onOpenAddItem}
        >
          + Add Item
        </button>
      </div>

      {/* Category Filter Pills */}
      <div className="chip-row" role="group" aria-label="Filter by category zone">
        <button
          type="button"
          className={`chip ${categoryFilter === '' ? 'active' : ''}`}
          onClick={() => onCategoryFilterChange('')}
        >
          All Zones
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`chip tabular-nums ${String(categoryFilter) === String(c.id) ? 'active' : ''}`}
            onClick={() => onCategoryFilterChange(String(c.id))}
          >
            {`${c.name} (${c.item_count})`}
          </button>
        ))}
      </div>

      {/* Status Filter Pills */}
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

      {/* Master-Detail Workspace */}
      <div className={`inv-workspace ${showInspector ? 'has-inspector' : ''}`}>
        <div>
          {loading && !items.length ? (
            <div className="zones-grid" aria-label="Loading inventory">
              {Array.from({ length: 3 }, (_, i) => (
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
                    const isSelected = selectedItemId === item.id;
                    return (
                      <tr
                        key={item.id}
                        className={`clickable-row ${isSelected ? 'row-selected' : ''}`}
                        onClick={() => onSelectItem(item.id)}
                      >
                        <td>
                          <strong>{item.name}</strong>
                          <div className="muted-text">{item.sku || `SKU-#${item.id}`}</div>
                        </td>
                        <td>{item.category_name || 'Uncategorized'}</td>
                        <td>
                          <span className={`badge badge-${cls}`}>{statusLabel(cls)}</span>
                        </td>
                        <td>{`${formatMoney(item.unit_price)} / ${item.unit || 'pcs'}`}</td>
                        <td>{formatMoney(item.quantity * Number(item.unit_price || 0))}</td>
                        <td>
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
                            <span className="qty-num">{item.quantity}</span>
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="zones-grid">
              {zoneGroups.map((zone) => {
                const totalUnits = zone.items.reduce((s, i) => s + Number(i.quantity || 0), 0);
                return (
                  <div key={zone.key} className="zone-card">
                    <div className="zone-header">
                      <h3 className="zone-title">{zone.name}</h3>
                      <span className="zone-meta">
                        {`${zone.items.length} SKU(s) · ${totalUnits} units`}
                      </span>
                    </div>

                    {zone.items.length === 0 ? (
                      <p className="muted-text">No items in this zone match the current filters.</p>
                    ) : (
                      <div className="zone-tiles-grid">
                        {zone.items.map((item) => {
                          const cls = statusOf(item);
                          const isSelected = selectedItemId === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className={`item-tile ${isSelected ? 'selected' : ''}`}
                              onClick={() => onSelectItem(item.id)}
                            >
                              <div className="item-tile-top">
                                <span className="item-tile-name">{item.name}</span>
                                <span
                                  className={`status-dot ${dotClassFor(cls)}`}
                                  title={statusLabel(cls)}
                                  aria-label={statusLabel(cls)}
                                />
                              </div>

                              <div className="item-tile-bottom">
                                <span className="item-tile-sku">
                                  {item.sku || `SKU-#${item.id}`}
                                </span>
                                <span className="item-tile-qty">
                                  {`${item.quantity} `}
                                  <span className="item-tile-qty-label">{item.unit || 'pcs'}</span>
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Persistent Right-Side Inspector Panel */}
        {showInspector && (
          <ItemDetailView
            item={detailItem}
            user={user}
            loading={loadingDetail}
            theme={theme}
            onClose={onCloseInspector}
            onQuickUpdate={onQuickUpdate}
            onEdit={onEditItem}
            onDelete={onDeleteItem}
            onApplyThreshold={onApplyThreshold}
            addToast={addToast}
          />
        )}
      </div>
    </section>
  );
}
