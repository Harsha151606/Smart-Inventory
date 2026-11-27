import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function ItemModal({
  isOpen,
  editingItem,
  categories,
  onClose,
  onSaved,
  onCategoryCreated,
  addToast
}) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sku, setSku] = useState('');
  const [quantity, setQuantity] = useState('0');
  const [threshold, setThreshold] = useState('5');
  const [unitPrice, setUnitPrice] = useState('0.00');
  const [unit, setUnit] = useState('pcs');
  const [autoQr, setAutoQr] = useState(true);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#1D61E7');
  const [creatingCat, setCreatingCat] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (editingItem) {
      setName(editingItem.name || '');
      setCategoryId(editingItem.category_id != null ? String(editingItem.category_id) : '');
      setSku(editingItem.sku || '');
      setQuantity(String(editingItem.quantity ?? 0));
      setThreshold(String(editingItem.threshold ?? 5));
      setUnitPrice(Number(editingItem.unit_price || 0).toFixed(2));
      setUnit(editingItem.unit || 'pcs');
      setDescription(editingItem.description || '');
      setAutoQr(true);
    } else {
      setName('');
      setCategoryId('');
      setSku('');
      setQuantity('0');
      setThreshold('5');
      setUnitPrice('0.00');
      setUnit('pcs');
      setAutoQr(true);
      setDescription('');
    }
    setShowNewCat(false);
    setNewCatName('');
    setNewCatColor('#1D61E7');
  }, [isOpen, editingItem]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape' && !saving && !creatingCat) onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, saving, creatingCat, onClose]);

  if (!isOpen) return null;

  const isEdit = Boolean(editingItem);

  async function handleCreateCategory() {
    const trimmed = newCatName.trim();
    if (!trimmed) {
      addToast('Category name is required', 'warn');
      return;
    }
    setCreatingCat(true);
    try {
      const created = await api('/api/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: trimmed,
          color: newCatColor.trim() || '#1D61E7'
        })
      });
      addToast('Category created');
      setShowNewCat(false);
      setNewCatName('');
      setCategoryId(String(created.id));
      await onCategoryCreated();
    } catch (err) {
      addToast(err.message || 'Failed to create category', 'error');
    } finally {
      setCreatingCat(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);

    const payload = {
      name: name.trim(),
      category_id: categoryId ? Number(categoryId) : null,
      quantity: Number.parseInt(quantity, 10) || 0,
      threshold: Number.parseInt(threshold, 10) || 0,
      unit_price: Number.parseFloat(unitPrice) || 0,
      unit: unit.trim() || 'pcs',
      sku: sku.trim(),
      description: description.trim()
    };
    if (!isEdit) {
      payload.auto_qr = autoQr;
    }

    const url = isEdit ? `/api/items/${editingItem.id}` : '/api/items';
    const method = isEdit ? 'PUT' : 'POST';

    try {
      const saved = await api(url, {
        method,
        body: JSON.stringify(payload)
      });
      addToast(isEdit ? 'Item updated' : 'Item created with signed QR');
      onSaved(saved, isEdit);
    } catch (err) {
      addToast(err.message || 'Failed to save item', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      id="item-modal-overlay"
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="item-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="modal-box">
        <div className="modal-header">
          <h3 id="item-modal-title" className="modal-title">
            {isEdit ? `Edit / Restock Item #${editingItem.id}` : 'Add New Inventory Item'}
          </h3>
          <button
            type="button"
            className="modal-close-btn"
            aria-label="Close item dialog"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form id="item-form" className="form-stack" onSubmit={handleSubmit}>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="f-name">Item Name *</label>
              <input
                id="f-name"
                type="text"
                required
                maxLength={160}
                placeholder="e.g., USB-C Cables"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="f-sku">SKU / Slot Code</label>
              <input
                id="f-sku"
                type="text"
                maxLength={64}
                placeholder="ELC-USBC-001"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <div className="label-row">
                <label htmlFor="f-cat">Category Zone</label>
                <button
                  id="btn-new-cat"
                  type="button"
                  className="btn-link"
                  onClick={() => setShowNewCat((prev) => !prev)}
                >
                  {showNewCat ? 'Cancel' : '+ New Zone'}
                </button>
              </div>
              <select
                id="f-cat"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">None</option>
                {categories.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="f-unit">Unit</label>
              <input
                id="f-unit"
                type="text"
                maxLength={32}
                placeholder="pcs, rolls, boxes"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
          </div>

          {showNewCat && (
            <div className="inline-cat-box">
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="new-cat-name">Category Name</label>
                  <input
                    id="new-cat-name"
                    type="text"
                    maxLength={100}
                    placeholder="e.g., Networking"
                    value={newCatName}
                    onChange={(e) => setNewCatName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="new-cat-color">Hex Color</label>
                  <input
                    id="new-cat-color"
                    type="text"
                    maxLength={7}
                    value={newCatColor}
                    onChange={(e) => setNewCatColor(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={creatingCat}
                  onClick={handleCreateCategory}
                >
                  {creatingCat ? 'Creating...' : 'Create Category'}
                </button>
              </div>
            </div>
          )}

          <div className="grid-3">
            <div className="field">
              <label htmlFor="f-qty">Quantity</label>
              <input
                id="f-qty"
                type="number"
                min={0}
                max={1000000}
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="f-thresh">Reorder Threshold</label>
              <input
                id="f-thresh"
                type="number"
                min={0}
                max={1000000}
                required
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="f-price">Unit Price ($)</label>
              <input
                id="f-price"
                type="number"
                min={0}
                max={10000000}
                step="0.01"
                required
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
              />
            </div>
          </div>

          {!isEdit && (
            <label className="checkbox-label">
              <input
                id="f-qr"
                type="checkbox"
                checked={autoQr}
                onChange={(e) => setAutoQr(e.target.checked)}
              />
              <span>Generate HMAC-signed QR code automatically</span>
            </label>
          )}

          <div className="field">
            <label htmlFor="f-desc">Storage Notes / Description</label>
            <textarea
              id="f-desc"
              rows={2}
              maxLength={1000}
              placeholder="Optional aisle, bin, or supplier notes"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Item'}
            </button>
            <button
              id="btn-cancel-form"
              type="button"
              className="btn btn-secondary"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
