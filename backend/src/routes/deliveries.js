import crypto from 'node:crypto';
import { Router } from 'express';
import { appendAuditLog, pool } from '../db.js';
import { invalidateInventoryCache } from '../middleware/cache.js';
import {
  deliveryCreateSchema,
  deliveryStatusUpdateSchema,
  parseBody
} from '../validation.js';

const VALID_DELIVERY_STATUSES = new Set(['pending', 'in_transit', 'delivered', 'delayed']);

function parsePositiveInt(raw) {
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function serializeDelivery(row) {
  return {
    ...row,
    quantity: Number(row.quantity),
    capacity_cubic_m: row.capacity_cubic_m != null ? Number(row.capacity_cubic_m) : null,
    current_load_pct: row.current_load_pct != null ? Number(row.current_load_pct) : 0
  };
}

const JOINED_SELECT = `
  SELECT d.*,
         v.plate_number,
         v.model AS vehicle_model,
         v.cargo_type AS vehicle_cargo_type,
         v.capacity_cubic_m,
         v.current_load_pct,
         v.status AS vehicle_status,
         i.name AS item_name,
         i.sku AS item_sku,
         i.unit AS item_unit
  FROM deliveries d
  JOIN vehicles v ON d.vehicle_id = v.id
  JOIN items i ON d.item_id = i.id
`;

export function createDeliveriesRouter(redisClient = null) {
  const router = Router();

  router.get('/deliveries', async (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : '';

      const conditions = [];
      const params = [];

      if (status && VALID_DELIVERY_STATUSES.has(status)) {
        params.push(status);
        conditions.push(`d.status = $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        const idx = params.length;
        conditions.push(
          `(d.tracking_code ILIKE $${idx} OR d.origin ILIKE $${idx} OR d.destination ILIKE $${idx} OR v.plate_number ILIKE $${idx} OR i.name ILIKE $${idx})`
        );
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `${JOINED_SELECT}
         ${whereClause}
         ORDER BY CASE WHEN d.status = 'delivered' THEN 1 ELSE 0 END ASC, d.updated_at DESC, d.id DESC`,
        params
      );

      return res.json(rows.map(serializeDelivery));
    } catch (err) {
      return next(err);
    }
  });

  router.post('/deliveries', async (req, res, next) => {
    const data = parseBody(deliveryCreateSchema, req, res);
    if (!data) return;

    let etaIso = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    if (data.eta) {
      const parsed = new Date(data.eta);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Invalid ETA timestamp' });
      }
      etaIso = parsed.toISOString();
    }

    const trackingCode =
      data.tracking_code ||
      `TRK-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const vehicleRes = await client.query(
        'SELECT * FROM vehicles WHERE id = $1 FOR UPDATE',
        [data.vehicle_id]
      );
      const vehicle = vehicleRes.rows[0];
      if (!vehicle) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Vehicle not found' });
      }
      if (vehicle.status !== 'available') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Vehicle ${vehicle.plate_number} is currently ${vehicle.status} and cannot be dispatched`
        });
      }

      const updateItemRes = await client.query(
        `UPDATE items
         SET quantity = quantity - $1, updated_at = NOW()
         WHERE id = $2 AND is_deleted = FALSE AND quantity >= $1
         RETURNING id, name, quantity`,
        [data.quantity, data.item_id]
      );
      if (updateItemRes.rowCount === 0) {
        const existsRes = await client.query(
          'SELECT id, quantity FROM items WHERE id = $1 AND is_deleted = FALSE',
          [data.item_id]
        );
        await client.query('ROLLBACK');
        if (!existsRes.rows[0]) {
          return res.status(404).json({ error: 'Item not found' });
        }
        return res.status(409).json({
          error: 'Insufficient stock for dispatch',
          available: existsRes.rows[0].quantity
        });
      }

      const updatedItem = updateItemRes.rows[0];
      const prevQty = updatedItem.quantity + data.quantity;

      await appendAuditLog(client, {
        itemId: updatedItem.id,
        userId: req.user.id,
        actionType: 'consumed',
        quantityChange: -data.quantity,
        previousQuantity: prevQty,
        newQuantity: updatedItem.quantity,
        notes: `Dispatched on ${vehicle.plate_number} (${trackingCode})`
      });

      const estimatedLoad = Math.min(100, Math.max(20, Math.round(data.quantity * 5)));
      await client.query(
        `UPDATE vehicles
         SET status = 'assigned', current_load_pct = $1
         WHERE id = $2`,
        [estimatedLoad, vehicle.id]
      );

      const insertRes = await client.query(
        `INSERT INTO deliveries (tracking_code, vehicle_id, item_id, quantity, origin, destination, status, eta, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, NOW())
         RETURNING id`,
        [
          trackingCode,
          vehicle.id,
          updatedItem.id,
          data.quantity,
          data.origin,
          data.destination,
          etaIso
        ]
      );

      const joinedRes = await client.query(`${JOINED_SELECT} WHERE d.id = $1`, [
        insertRes.rows[0].id
      ]);

      await client.query('COMMIT');
      await invalidateInventoryCache(redisClient);
      return res.status(201).json(serializeDelivery(joinedRes.rows[0]));
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Tracking code already exists' });
      }
      return next(err);
    } finally {
      client.release();
    }
  });

  router.patch('/deliveries/:id/status', async (req, res, next) => {
    const deliveryId = parsePositiveInt(req.params.id);
    if (!deliveryId) return res.status(400).json({ error: 'Invalid delivery ID' });

    const data = parseBody(deliveryStatusUpdateSchema, req, res);
    if (!data) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existingRes = await client.query(
        'SELECT * FROM deliveries WHERE id = $1 FOR UPDATE',
        [deliveryId]
      );
      const existing = existingRes.rows[0];
      if (!existing) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Delivery not found' });
      }

      if (existing.status === 'delivered' && data.status !== 'delivered') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Delivered shipments cannot be reverted' });
      }

      await client.query(
        'UPDATE deliveries SET status = $1, updated_at = NOW() WHERE id = $2',
        [data.status, deliveryId]
      );

      if (data.status === 'delivered') {
        await client.query(
          "UPDATE vehicles SET status = 'available', current_load_pct = 0 WHERE id = $1",
          [existing.vehicle_id]
        );
      }

      const joinedRes = await client.query(`${JOINED_SELECT} WHERE d.id = $1`, [deliveryId]);

      await client.query('COMMIT');
      await invalidateInventoryCache(redisClient);
      return res.json(serializeDelivery(joinedRes.rows[0]));
    } catch (err) {
      await client.query('ROLLBACK');
      return next(err);
    } finally {
      client.release();
    }
  });

  return router;
}
