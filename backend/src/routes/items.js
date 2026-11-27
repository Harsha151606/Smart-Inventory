import { Router } from 'express';
import QRCode from 'qrcode';
import { appendAuditLog, pool } from '../db.js';
import {
  detectAnomalies,
  forecastDemand,
  predictDepletion,
  suggestThreshold
} from '../aiEngine.js';
import { requireRole, signQrPayload, verifyQrPayload } from '../security.js';
import { invalidateInventoryCache } from '../middleware/cache.js';
import {
  itemCreateSchema,
  itemUpdateSchema,
  parseBody,
  qrVerifySchema,
  quantityDeltaSchema
} from '../validation.js';

const SORT_WHITELIST = {
  name: 'i.name ASC',
  quantity: 'i.quantity ASC',
  value: '(i.quantity * i.unit_price) DESC',
  recent: 'i.updated_at DESC',
  category: 'c.name ASC NULLS LAST, i.name ASC'
};

function parsePositiveInt(raw) {
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

async function generateQrBase64(payload) {
  const dataUrl = await QRCode.toDataURL(payload, {
    width: 240,
    margin: 2,
    color: { dark: '#0f172a', light: '#ffffff' }
  });
  return dataUrl.replace(/^data:image\/png;base64,/, '');
}

export function createItemsRouter(redisClient = null) {
  const router = Router();

  router.get('/items', async (req, res, next) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 120) : '';
      const category = parsePositiveInt(req.query.category);
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      const sortKey = typeof req.query.sort === 'string' ? req.query.sort : 'name';
      const orderBy = SORT_WHITELIST[sortKey] || SORT_WHITELIST.name;

      const conditions = ['i.is_deleted = FALSE'];
      const params = [];

      if (q) {
        params.push(`%${q}%`);
        const idx = params.length;
        conditions.push(`(i.name ILIKE $${idx} OR i.sku ILIKE $${idx} OR i.description ILIKE $${idx})`);
      }
      if (category) {
        params.push(category);
        conditions.push(`i.category_id = $${params.length}`);
      }
      if (status === 'low') {
        conditions.push('i.quantity <= i.threshold AND i.quantity > 0');
      } else if (status === 'out') {
        conditions.push('i.quantity = 0');
      } else if (status === 'ok') {
        conditions.push('i.quantity > i.threshold');
      }

      const sql = `
        SELECT i.*, c.name AS category_name, c.color AS category_color
        FROM items i
        LEFT JOIN categories c ON i.category_id = c.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${orderBy}
      `;
      const { rows } = await pool.query(sql, params);
      return res.json(rows.map((r) => ({ ...r, unit_price: Number(r.unit_price) })));
    } catch (err) {
      return next(err);
    }
  });

  router.post('/items', async (req, res, next) => {
    const data = parseBody(itemCreateSchema, req, res);
    if (!data) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insertRes = await client.query(
        `INSERT INTO items (name, category_id, quantity, threshold, unit_price, unit, description, sku)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id`,
        [
          data.name,
          data.category_id ?? null,
          data.quantity,
          data.threshold,
          data.unit_price,
          data.unit,
          data.description,
          data.sku
        ]
      );
      const itemId = insertRes.rows[0].id;

      if (data.auto_qr) {
        const signedQr = signQrPayload(itemId, data.name);
        await client.query('UPDATE items SET qr_data = $1 WHERE id = $2', [signedQr, itemId]);
      }

      await appendAuditLog(client, {
        itemId,
        userId: req.user.id,
        actionType: 'created',
        quantityChange: data.quantity,
        previousQuantity: 0,
        newQuantity: data.quantity,
        notes: 'Item created'
      });

      const itemRes = await client.query(
        `SELECT i.*, c.name AS category_name, c.color AS category_color
         FROM items i LEFT JOIN categories c ON i.category_id = c.id
         WHERE i.id = $1`,
        [itemId]
      );
      await client.query('COMMIT');
      await invalidateInventoryCache(redisClient);
      const item = itemRes.rows[0];
      return res.status(201).json({ ...item, unit_price: Number(item.unit_price) });
    } catch (err) {
      await client.query('ROLLBACK');
      return next(err);
    } finally {
      client.release();
    }
  });

  router.get('/items/:id', async (req, res, next) => {
    try {
      const itemId = parsePositiveInt(req.params.id);
      if (!itemId) return res.status(400).json({ error: 'Invalid item ID' });

      const itemRes = await pool.query(
        `SELECT i.*, c.name AS category_name, c.color AS category_color
         FROM items i LEFT JOIN categories c ON i.category_id = c.id
         WHERE i.id = $1 AND i.is_deleted = FALSE`,
        [itemId]
      );
      const item = itemRes.rows[0];
      if (!item) return res.status(404).json({ error: 'Item not found' });

      const qrPayload = item.qr_data || signQrPayload(item.id, item.name);
      const [qrImage, txnsRes, prediction, suggestedThreshold, anomalies, forecast] = await Promise.all([
        generateQrBase64(qrPayload),
        pool.query(
          `SELECT t.*, u.name AS actor_name
           FROM transaction_logs t
           LEFT JOIN users u ON u.id = t.user_id
           WHERE t.item_id = $1
           ORDER BY t.id DESC LIMIT 12`,
          [itemId]
        ),
        predictDepletion(pool, itemId),
        suggestThreshold(pool, itemId),
        detectAnomalies(pool, itemId),
        forecastDemand(pool, itemId, 14)
      ]);

      return res.json({
        ...item,
        unit_price: Number(item.unit_price),
        qr_data: qrPayload,
        qr_image: qrImage,
        transactions: txnsRes.rows,
        prediction,
        suggested_threshold: suggestedThreshold,
        anomalies,
        forecast
      });
    } catch (err) {
      return next(err);
    }
  });

  router.put('/items/:id', async (req, res, next) => {
    const itemId = parsePositiveInt(req.params.id);
    if (!itemId) return res.status(400).json({ error: 'Invalid item ID' });
    const data = parseBody(itemUpdateSchema, req, res);
    if (!data) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const oldRes = await client.query(
        'SELECT * FROM items WHERE id = $1 AND is_deleted = FALSE FOR UPDATE',
        [itemId]
      );
      const old = oldRes.rows[0];
      if (!old) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Item not found' });
      }

      const nextName = data.name ?? old.name;
      const nextCat = data.category_id === undefined ? old.category_id : data.category_id;
      const nextQty = data.quantity ?? old.quantity;
      const nextThresh = data.threshold ?? old.threshold;
      const nextPrice = data.unit_price ?? Number(old.unit_price);
      const nextUnit = data.unit ?? old.unit;
      const nextDesc = data.description ?? old.description;
      const nextSku = data.sku ?? old.sku;
      const nextQr = nextName !== old.name ? signQrPayload(itemId, nextName) : old.qr_data;

      await client.query(
        `UPDATE items
         SET name=$1, category_id=$2, quantity=$3, threshold=$4, unit_price=$5,
             unit=$6, description=$7, sku=$8, qr_data=$9, updated_at=NOW()
         WHERE id=$10`,
        [nextName, nextCat, nextQty, nextThresh, nextPrice, nextUnit, nextDesc, nextSku, nextQr, itemId]
      );

      if (nextQty !== old.quantity) {
        await appendAuditLog(client, {
          itemId,
          userId: req.user.id,
          actionType: 'adjusted',
          quantityChange: nextQty - old.quantity,
          previousQuantity: old.quantity,
          newQuantity: nextQty,
          notes: 'Manual item update'
        });
      }

      const updatedRes = await client.query(
        `SELECT i.*, c.name AS category_name, c.color AS category_color
         FROM items i LEFT JOIN categories c ON i.category_id = c.id
         WHERE i.id = $1`,
        [itemId]
      );
      await client.query('COMMIT');
      await invalidateInventoryCache(redisClient);
      const item = updatedRes.rows[0];
      return res.json({ ...item, unit_price: Number(item.unit_price) });
    } catch (err) {
      await client.query('ROLLBACK');
      return next(err);
    } finally {
      client.release();
    }
  });

  // Soft-delete preserves SHA-256 hash chain continuity
  router.delete('/items/:id', requireRole('admin'), async (req, res, next) => {
    const itemId = parsePositiveInt(req.params.id);
    if (!itemId) return res.status(400).json({ error: 'Invalid item ID' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rowRes = await client.query(
        'SELECT id, quantity FROM items WHERE id = $1 AND is_deleted = FALSE FOR UPDATE',
        [itemId]
      );
      const item = rowRes.rows[0];
      if (!item) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Item not found' });
      }

      await client.query(
        'UPDATE items SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
        [itemId]
      );

      const log = await appendAuditLog(client, {
        itemId,
        userId: req.user.id,
        actionType: 'deleted',
        quantityChange: -item.quantity,
        previousQuantity: item.quantity,
        newQuantity: 0,
        notes: 'Item archived by administrator'
      });

      await client.query('COMMIT');
      await invalidateInventoryCache(redisClient);
      return res.json({ success: true, record_hash: log.record_hash });
    } catch (err) {
      await client.query('ROLLBACK');
      return next(err);
    } finally {
      client.release();
    }
  });

  async function adjustStock(req, res, next, direction) {
    const itemId = parsePositiveInt(req.params.id);
    if (!itemId) return res.status(400).json({ error: 'Invalid item ID' });
    const data = parseBody(quantityDeltaSchema, req, res);
    if (!data) return;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let prevQty, newQty;

      if (direction === 'inc') {
        const updateRes = await client.query(
          `UPDATE items SET quantity = quantity + $1, updated_at = NOW()
           WHERE id = $2 AND is_deleted = FALSE
           RETURNING quantity`,
          [data.amount, itemId]
        );
        if (updateRes.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Item not found' });
        }
        newQty = updateRes.rows[0].quantity;
        prevQty = newQty - data.amount;
      } else {
        const updateRes = await client.query(
          `UPDATE items SET quantity = quantity - $1, updated_at = NOW()
           WHERE id = $2 AND is_deleted = FALSE AND quantity >= $1
           RETURNING quantity`,
          [data.amount, itemId]
        );
        if (updateRes.rowCount === 0) {
          // Check if item exists
          const exists = await client.query(
            'SELECT id, quantity FROM items WHERE id = $1 AND is_deleted = FALSE',
            [itemId]
          );
          if (!exists.rows[0]) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Item not found' });
          }
          await client.query('ROLLBACK');
          return res.status(409).json({ error: 'Insufficient stock', available: exists.rows[0].quantity });
        }
        newQty = updateRes.rows[0].quantity;
        prevQty = newQty + data.amount;
      }

      const actualDelta = newQty - prevQty;

      const log = await appendAuditLog(client, {
        itemId,
        userId: req.user.id,
        actionType: direction === 'inc' ? 'restocked' : 'consumed',
        quantityChange: actualDelta,
        previousQuantity: prevQty,
        newQuantity: newQty,
        notes: data.notes || (direction === 'inc' ? 'Quick increment' : 'Quick decrement')
      });

      await client.query('COMMIT');
      await invalidateInventoryCache(redisClient);
      return res.json({ quantity: newQty, record_hash: log.record_hash });
    } catch (err) {
      await client.query('ROLLBACK');
      return next(err);
    } finally {
      client.release();
    }
  }

  router.post('/items/:id/increment', (req, res, next) => adjustStock(req, res, next, 'inc'));
  router.post('/items/:id/decrement', (req, res, next) => adjustStock(req, res, next, 'dec'));

  router.get('/qr/:id', async (req, res, next) => {
    try {
      const itemId = parsePositiveInt(req.params.id);
      if (!itemId) return res.status(400).json({ error: 'Invalid item ID' });
      const { rows } = await pool.query(
        'SELECT id, name, qr_data FROM items WHERE id = $1 AND is_deleted = FALSE',
        [itemId]
      );
      const item = rows[0];
      if (!item) return res.status(404).json({ error: 'Item not found' });
      const qrData = item.qr_data || signQrPayload(item.id, item.name);
      const qrImage = await generateQrBase64(qrData);
      return res.json({ qr_image: qrImage, qr_data: qrData });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/qr/verify', async (req, res, next) => {
    try {
      const data = parseBody(qrVerifySchema, req, res);
      if (!data) return;
      const verdict = verifyQrPayload(data.payload);
      if (!verdict.valid) {
        return res.status(400).json({ valid: false, error: verdict.reason });
      }
      const { rows } = await pool.query(
        `SELECT i.*, c.name AS category_name
         FROM items i LEFT JOIN categories c ON i.category_id = c.id
         WHERE i.id = $1 AND i.is_deleted = FALSE`,
        [verdict.id]
      );
      if (!rows[0]) return res.status(404).json({ valid: false, error: 'Item does not exist or was archived' });
      return res.json({ valid: true, item: { ...rows[0], unit_price: Number(rows[0].unit_price) } });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
