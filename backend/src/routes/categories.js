import { Router } from 'express';
import { pool } from '../db.js';
import { requireRole } from '../security.js';
import { invalidateInventoryCache } from '../middleware/cache.js';
import { categoryCreateSchema, parseBody } from '../validation.js';

export function createCategoriesRouter(redisClient = null) {
  const router = Router();

  router.get('/categories', async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT c.*, COUNT(i.id)::int AS item_count
         FROM categories c
         LEFT JOIN items i ON c.id = i.category_id AND i.is_deleted = FALSE
         GROUP BY c.id
         ORDER BY c.name ASC`
      );
      return res.json(rows);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/categories', async (req, res, next) => {
    try {
      const data = parseBody(categoryCreateSchema, req, res);
      if (!data) return;
      const { rows } = await pool.query(
        'INSERT INTO categories (name, description, color) VALUES ($1, $2, $3) RETURNING *',
        [data.name, data.description, data.color]
      );
      await invalidateInventoryCache(redisClient);
      return res.status(201).json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'Category name already exists' });
      }
      return next(err);
    }
  });

  router.delete('/categories/:id', requireRole('admin'), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid category ID' });
      await pool.query('DELETE FROM categories WHERE id = $1', [id]);
      await invalidateInventoryCache(redisClient);
      return res.json({ success: true });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
