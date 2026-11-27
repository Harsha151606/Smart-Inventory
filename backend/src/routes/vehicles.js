import { Router } from 'express';
import { pool } from '../db.js';
import { invalidateInventoryCache } from '../middleware/cache.js';
import {
  parseBody,
  vehicleCreateSchema,
  vehicleUpdateSchema
} from '../validation.js';

const VALID_STATUSES = new Set(['available', 'assigned', 'service_needed']);

function parsePositiveInt(raw) {
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function serializeVehicle(row) {
  return {
    ...row,
    capacity_cubic_m: Number(row.capacity_cubic_m),
    current_load_pct: Number(row.current_load_pct)
  };
}

export function createVehiclesRouter(redisClient = null) {
  const router = Router();

  router.get('/vehicles', async (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 120) : '';

      const summaryRes = await pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'available')::int AS available,
          COUNT(*) FILTER (WHERE status = 'assigned')::int AS assigned,
          COUNT(*) FILTER (WHERE status = 'service_needed')::int AS service_needed
        FROM vehicles
      `);

      const conditions = [];
      const params = [];

      if (status && VALID_STATUSES.has(status)) {
        params.push(status);
        conditions.push(`status = $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        const idx = params.length;
        conditions.push(`(plate_number ILIKE $${idx} OR model ILIKE $${idx} OR cargo_type ILIKE $${idx})`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const rowsRes = await pool.query(
        `SELECT *
         FROM vehicles
         ${whereClause}
         ORDER BY created_at DESC, id DESC`,
        params
      );

      return res.json({
        summary: summaryRes.rows[0],
        vehicles: rowsRes.rows.map(serializeVehicle)
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/vehicles', async (req, res, next) => {
    const data = parseBody(vehicleCreateSchema, req, res);
    if (!data) return;

    let serviceDate = null;
    if (data.last_service_date) {
      const parsed = new Date(data.last_service_date);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Invalid last_service_date' });
      }
      serviceDate = parsed.toISOString();
    }

    try {
      const { rows } = await pool.query(
        `INSERT INTO vehicles (plate_number, model, cargo_type, capacity_cubic_m, current_load_pct, status, last_service_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          data.plate_number,
          data.model,
          data.cargo_type,
          data.capacity_cubic_m,
          data.current_load_pct,
          data.status,
          serviceDate
        ]
      );

      await invalidateInventoryCache(redisClient);
      return res.status(201).json(serializeVehicle(rows[0]));
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'A vehicle with this plate number already exists' });
      }
      return next(err);
    }
  });

  router.patch('/vehicles/:id', async (req, res, next) => {
    const vehicleId = parsePositiveInt(req.params.id);
    if (!vehicleId) return res.status(400).json({ error: 'Invalid vehicle ID' });

    const data = parseBody(vehicleUpdateSchema, req, res);
    if (!data) return;

    let serviceDateProvided = data.last_service_date !== undefined;
    let nextServiceDate = null;
    if (serviceDateProvided && data.last_service_date !== null) {
      const parsed = new Date(data.last_service_date);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Invalid last_service_date' });
      }
      nextServiceDate = parsed.toISOString();
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const oldRes = await client.query('SELECT * FROM vehicles WHERE id = $1 FOR UPDATE', [vehicleId]);
      const old = oldRes.rows[0];
      if (!old) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Vehicle not found' });
      }

      const nextPlate = data.plate_number ?? old.plate_number;
      const nextModel = data.model ?? old.model;
      const nextCargo = data.cargo_type ?? old.cargo_type;
      const nextCapacity = data.capacity_cubic_m ?? Number(old.capacity_cubic_m);
      const nextLoad = data.current_load_pct ?? old.current_load_pct;
      const nextStatus = data.status ?? old.status;
      const resolvedServiceDate = serviceDateProvided ? nextServiceDate : old.last_service_date;

      const updatedRes = await client.query(
        `UPDATE vehicles
         SET plate_number = $1,
             model = $2,
             cargo_type = $3,
             capacity_cubic_m = $4,
             current_load_pct = $5,
             status = $6,
             last_service_date = $7
         WHERE id = $8
         RETURNING *`,
        [
          nextPlate,
          nextModel,
          nextCargo,
          nextCapacity,
          nextLoad,
          nextStatus,
          resolvedServiceDate,
          vehicleId
        ]
      );

      await client.query('COMMIT');
      await invalidateInventoryCache(redisClient);
      return res.json(serializeVehicle(updatedRes.rows[0]));
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23505') {
        return res.status(409).json({ error: 'A vehicle with this plate number already exists' });
      }
      return next(err);
    } finally {
      client.release();
    }
  });

  router.delete('/vehicles/:id', async (req, res, next) => {
    const vehicleId = parsePositiveInt(req.params.id);
    if (!vehicleId) return res.status(400).json({ error: 'Invalid vehicle ID' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rowRes = await client.query(
        'SELECT id, status FROM vehicles WHERE id = $1 FOR UPDATE',
        [vehicleId]
      );
      const vehicle = rowRes.rows[0];
      if (!vehicle) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Vehicle not found' });
      }

      if (vehicle.status === 'assigned') {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Cannot delete an assigned vehicle' });
      }

      const activeDel = await client.query(
        "SELECT id FROM deliveries WHERE vehicle_id = $1 AND status != 'delivered' LIMIT 1",
        [vehicleId]
      );
      if (activeDel.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Vehicle has active delivery assignments' });
      }

      await client.query('DELETE FROM vehicles WHERE id = $1', [vehicleId]);
      await client.query('COMMIT');
      await invalidateInventoryCache(redisClient);
      return res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23503') {
        return res.status(409).json({
          error: 'Vehicle has historical delivery records; mark as service_needed instead'
        });
      }
      return next(err);
    } finally {
      client.release();
    }
  });

  return router;
}
