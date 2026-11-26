import { Router } from 'express';
import { pool } from '../db.js';
import { config } from '../config.js';
import {
  clearAuthCookies,
  ensureCsrfCookie,
  generateRandomToken,
  hashPassword,
  hashToken,
  issueAccessToken,
  needsPasswordRehash,
  requireAuth,
  requireRole,
  setAuthCookies,
  verifyDummyPassword,
  verifyPassword
} from '../security.js';
import { adminCreateUserSchema, loginSchema, parseBody, registerSchema } from '../validation.js';

export function createAuthRouter(authLimiter) {
  const router = Router();

  async function issueSessionTokens(user, res) {
    const accessToken = issueAccessToken(user);
    const rawRefresh = generateRandomToken(32);
    const refreshHash = hashToken(rawRefresh);
    const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 86400000);

    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshHash, expiresAt.toISOString()]
    );
    setAuthCookies(res, accessToken, rawRefresh);
  }

  router.get('/csrf', (req, res) => {
    const token = ensureCsrfCookie(req, res);
    res.json({ csrfToken: token });
  });

  router.get('/status', async (_req, res, next) => {
    try {
      const countRes = await pool.query('SELECT COUNT(*)::int AS c FROM users');
      const needsBootstrap = Number(countRes.rows[0].c) === 0;
      res.json({
        needsBootstrap,
        registrationOpen: needsBootstrap || config.allowPublicRegistration
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/register', authLimiter, async (req, res, next) => {
    try {
      const data = parseBody(registerSchema, req, res);
      if (!data) return;

      const countRes = await pool.query('SELECT COUNT(*)::int AS c FROM users');
      const userCount = Number(countRes.rows[0].c);
      if (userCount > 0 && !config.allowPublicRegistration) {
        return res.status(403).json({
          error: 'Public registration is disabled. Ask an administrator to create your account.'
        });
      }

      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [data.email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      const role = userCount === 0 ? 'admin' : 'staff';
      const pwHash = await hashPassword(data.password);

      const inserted = await pool.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at',
        [data.name, data.email, pwHash, role]
      );
      const user = inserted.rows[0];
      await issueSessionTokens(user, res);
      ensureCsrfCookie(req, res);

      return res.status(201).json({ user });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/login', authLimiter, async (req, res, next) => {
    try {
      const data = parseBody(loginSchema, req, res);
      if (!data) return;

      const userRes = await pool.query(
        'SELECT id, name, email, password_hash, role, failed_login_attempts, locked_until FROM users WHERE email = $1',
        [data.email]
      );
      const user = userRes.rows[0];

      if (!user) {
        await verifyDummyPassword(data.password);
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
        return res.status(423).json({
          error: 'Account temporarily locked due to repeated failed attempts. Try again later.'
        });
      }

      const valid = await verifyPassword(user.password_hash, data.password);
      if (!valid) {
        const attempts = user.failed_login_attempts + 1;
        const lockedUntil =
          attempts >= config.maxFailedLogins
            ? new Date(Date.now() + config.lockoutMinutes * 60000).toISOString()
            : null;
        await pool.query(
          'UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3',
          [attempts, lockedUntil, user.id]
        );
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      let updatedHash = user.password_hash;
      if (needsPasswordRehash(user.password_hash)) {
        updatedHash = await hashPassword(data.password);
      }

      await pool.query(
        'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, password_hash = $1 WHERE id = $2',
        [updatedHash, user.id]
      );

      await issueSessionTokens(user, res);
      ensureCsrfCookie(req, res);

      return res.json({
        user: { id: user.id, name: user.name, email: user.email, role: user.role }
      });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/refresh', async (req, res, next) => {
    try {
      const rawRefresh = req.cookies?.refresh_token;
      if (!rawRefresh) {
        return res.status(401).json({ error: 'Refresh token missing' });
      }
      const tokenHash = hashToken(rawRefresh);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tokRes = await client.query(
          `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked, u.name, u.email, u.role
           FROM refresh_tokens rt
           JOIN users u ON u.id = rt.user_id
           WHERE rt.token_hash = $1
           FOR UPDATE`,
          [tokenHash]
        );
        const row = tokRes.rows[0];
        if (!row || row.revoked || new Date(row.expires_at).getTime() <= Date.now()) {
          await client.query('ROLLBACK');
          clearAuthCookies(res);
          return res.status(401).json({ error: 'Session expired. Please sign in again.' });
        }

        await client.query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [row.id]);
        const newRawRefresh = generateRandomToken(32);
        const newHash = hashToken(newRawRefresh);
        const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 86400000);
        await client.query(
          'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
          [row.user_id, newHash, expiresAt.toISOString()]
        );
        await client.query('COMMIT');

        const user = { id: row.user_id, name: row.name, email: row.email, role: row.role };
        const accessToken = issueAccessToken(user);
        setAuthCookies(res, accessToken, newRawRefresh);
        ensureCsrfCookie(req, res);
        return res.json({ user });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      return next(err);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const rawRefresh = req.cookies?.refresh_token;
      if (rawRefresh) {
        await pool.query('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1', [
          hashToken(rawRefresh)
        ]);
      }
      clearAuthCookies(res);
      return res.json({ success: true });
    } catch (err) {
      return next(err);
    }
  });

  router.post('/logout-all', requireAuth, async (req, res, next) => {
    try {
      await pool.query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1', [req.user.id]);
      clearAuthCookies(res);
      return res.json({ success: true });
    } catch (err) {
      return next(err);
    }
  });

  router.get('/me', requireAuth, (req, res) => {
    ensureCsrfCookie(req, res);
    res.json({ user: req.user });
  });

  // Admin-only team management
  router.get('/users', requireAuth, requireRole('admin'), async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        'SELECT id, name, email, role, created_at FROM users ORDER BY id ASC'
      );
      return res.json(rows);
    } catch (err) {
      return next(err);
    }
  });

  router.post('/users', requireAuth, requireRole('admin'), async (req, res, next) => {
    try {
      const data = parseBody(adminCreateUserSchema, req, res);
      if (!data) return;

      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [data.email]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const pwHash = await hashPassword(data.password);
      const { rows } = await pool.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, created_at',
        [data.name, data.email, pwHash, data.role]
      );
      return res.status(201).json(rows[0]);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
