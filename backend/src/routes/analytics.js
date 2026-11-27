import { Router } from 'express';
import { pool, runStockCheck } from '../db.js';
import {
  calculateConsumptionRate,
  detectAnomalies,
  forecastDemand,
  getInsights,
  predictDepletion,
  suggestThreshold
} from '../aiEngine.js';
import { computeAuditHash, GENESIS_HASH, safeEqualHex } from '../security.js';
import { invalidateInventoryCache } from '../middleware/cache.js';

export function createAnalyticsRouter(redisClient = null) {
  const router = Router();

  router.get('/analytics', async (_req, res, next) => {
    try {
      const insights = await getInsights(pool);
      return res.json(insights);
    } catch (err) {
      return next(err);
    }
  });

  router.get('/analytics/:id', async (req, res, next) => {
    try {
      const itemId = Number(req.params.id);
      if (!Number.isInteger(itemId) || itemId <= 0) {
        return res.status(400).json({ error: 'Invalid item ID' });
      }
      const [prediction, suggestedThreshold, anomalies, forecast, consumptionRate] = await Promise.all([
        predictDepletion(pool, itemId),
        suggestThreshold(pool, itemId),
        detectAnomalies(pool, itemId),
        forecastDemand(pool, itemId, 14),
        calculateConsumptionRate(pool, itemId, 30)
      ]);
      return res.json({
        prediction,
        suggested_threshold: suggestedThreshold,
        anomalies,
        forecast,
        consumption_rate: consumptionRate
      });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/alerts', async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT a.*, i.name AS item_name
         FROM alert_logs a
         JOIN items i ON a.item_id = i.id
         ORDER BY a.created_at DESC
         LIMIT 25`
      );
      return res.json(rows);
    } catch (err) {
      return next(err);
    }
  });

  router.get('/transactions', async (req, res, next) => {
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
      const { rows } = await pool.query(
        `SELECT t.*, i.name AS item_name, u.name AS actor_name
         FROM transaction_logs t
         JOIN items i ON t.item_id = i.id
         LEFT JOIN users u ON u.id = t.user_id
         ORDER BY t.id DESC
         LIMIT $1`,
        [limit]
      );
      return res.json(rows);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/check-stock', async (_req, res, next) => {
    try {
      const created = await runStockCheck();
      await invalidateInventoryCache(redisClient);
      return res.json({ success: true, alerts_created: created });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/audit/verify', async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, item_id, user_id, action_type, quantity_change, previous_quantity,
                new_quantity, notes, prev_hash, record_hash, timestamp_iso
         FROM transaction_logs
         ORDER BY id ASC`
      );

      let expectedPrev = GENESIS_HASH;
      for (const row of rows) {
        if (!safeEqualHex(row.prev_hash, expectedPrev)) {
          return res.json({
            valid: false,
            checked_count: rows.length,
            tampered_record_id: row.id,
            reason: 'Previous hash link mismatch'
          });
        }
        const recomputed = computeAuditHash({
          prevHash: row.prev_hash,
          itemId: row.item_id,
          userId: row.user_id,
          actionType: row.action_type,
          quantityChange: row.quantity_change,
          previousQuantity: row.previous_quantity,
          newQuantity: row.new_quantity,
          notes: row.notes,
          timestampIso: row.timestamp_iso
        });
        if (!safeEqualHex(row.record_hash, recomputed)) {
          return res.json({
            valid: false,
            checked_count: rows.length,
            tampered_record_id: row.id,
            reason: 'SHA-256 record digest mismatch'
          });
        }
        expectedPrev = row.record_hash;
      }

      return res.json({
        valid: true,
        checked_count: rows.length,
        latest_hash: expectedPrev
      });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
