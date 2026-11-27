import { useEffect, useState } from 'react';
import { createVehicle, updateVehicle } from '../api.js';

export default function VehicleModal({
  isOpen,
  editingVehicle,
  onClose,
  onSaved,
  addToast
}) {
  const [plateNumber, setPlateNumber] = useState('');
  const [model, setModel] = useState('');
  const [cargoType, setCargoType] = useState('');
  const [capacity, setCapacity] = useState('336.548');
  const [loadPct, setLoadPct] = useState('0');
  const [status, setStatus] = useState('available');
  const [lastServiceDate, setLastServiceDate] = useState('');
  const [validationError, setValidationError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setValidationError('');
    if (editingVehicle) {
      setPlateNumber(editingVehicle.plate_number || '');
      setModel(editingVehicle.model || '');
      setCargoType(editingVehicle.cargo_type || '');
      setCapacity(String(editingVehicle.capacity_cubic_m ?? ''));
      setLoadPct(String(editingVehicle.current_load_pct ?? 0));
      setStatus(editingVehicle.status || 'available');
      setLastServiceDate(
        editingVehicle.last_service_date
          ? String(editingVehicle.last_service_date).slice(0, 10)
          : ''
      );
    } else {
      setPlateNumber('');
      setModel('');
      setCargoType('Medium Truck');
      setCapacity('336.548');
      setLoadPct('0');
      setStatus('available');
      setLastServiceDate(new Date().toISOString().slice(0, 10));
    }
  }, [isOpen, editingVehicle]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const isEdit = Boolean(editingVehicle);

  async function handleSubmit(e) {
    e.preventDefault();
    setValidationError('');

    const plate = plateNumber.trim();
    const mod = model.trim();
    const cargo = cargoType.trim();
    const capNum = Number.parseFloat(capacity);
    const loadNum = Number.parseInt(loadPct, 10);

    if (plate.length < 2) {
      setValidationError('Plate number must be at least 2 characters.');
      return;
    }
    if (!mod) {
      setValidationError('Cargo model is required.');
      return;
    }
    if (!cargo) {
      setValidationError('Cargo type is required.');
      return;
    }
    if (!Number.isFinite(capNum) || capNum <= 0) {
      setValidationError('Capacity must be a positive number in cubic meters.');
      return;
    }
    if (!Number.isInteger(loadNum) || loadNum < 0 || loadNum > 100) {
      setValidationError('Current load percentage must be between 0 and 100.');
      return;
    }

    let serviceIso = null;
    const rawService = lastServiceDate.trim();
    if (rawService) {
      const parsedService = new Date(rawService);
      if (Number.isNaN(parsedService.getTime())) {
        setValidationError('Last service date must be a valid date (YYYY-MM-DD).');
        return;
      }
      serviceIso = parsedService.toISOString();
    }

    const payload = {
      plate_number: plate,
      model: mod,
      cargo_type: cargo,
      capacity_cubic_m: capNum,
      current_load_pct: loadNum,
      status,
      last_service_date: serviceIso
    };

    setSaving(true);
    try {
      const saved = isEdit
        ? await updateVehicle(editingVehicle.id, payload)
        : await createVehicle(payload);
      addToast(isEdit ? `Updated vehicle ${saved.plate_number}` : `Added vehicle ${saved.plate_number}`);
      onSaved(saved);
    } catch (err) {
      const msg = err.message || 'Failed to save vehicle';
      setValidationError(msg);
      addToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      id="vehicle-modal-overlay"
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vehicle-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="modal-box">
        <div className="modal-header">
          <h3 id="vehicle-modal-title" className="modal-title">
            {isEdit ? `Edit Vehicle (${editingVehicle.plate_number})` : 'Add Delivery Vehicle'}
          </h3>
          <button
            type="button"
            className="modal-close-btn"
            aria-label="Close vehicle dialog"
            disabled={saving}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form className="form-stack" onSubmit={handleSubmit} noValidate>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="v-plate">Plate Number *</label>
              <input
                id="v-plate"
                type="text"
                required
                maxLength={32}
                placeholder="B 9011 XYP"
                value={plateNumber}
                onChange={(e) => setPlateNumber(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="v-model">Vehicle Model *</label>
              <input
                id="v-model"
                type="text"
                required
                maxLength={120}
                placeholder="Daihatsu Luxio"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="v-cargo">Cargo Type *</label>
              <input
                id="v-cargo"
                type="text"
                required
                maxLength={80}
                placeholder="Medium Truck"
                value={cargoType}
                onChange={(e) => setCargoType(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="v-capacity">Capacity (m³) *</label>
              <input
                id="v-capacity"
                type="number"
                step="0.001"
                min="0.001"
                required
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="v-load">Current Load (%)</label>
              <input
                id="v-load"
                type="number"
                min={0}
                max={100}
                required
                value={loadPct}
                onChange={(e) => setLoadPct(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="v-status">Status</label>
              <select id="v-status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="available">Available</option>
                <option value="assigned">Assigned</option>
                <option value="service_needed">Service Needed</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="v-service-date">Last Service Date</label>
            <input
              id="v-service-date"
              type="text"
              placeholder="YYYY-MM-DD"
              value={lastServiceDate}
              onChange={(e) => setLastServiceDate(e.target.value)}
            />
          </div>

          {validationError && (
            <p className="form-error" role="alert">
              {validationError}
            </p>
          )}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Save Vehicle' : 'Add Vehicle'}
            </button>
            <button
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
