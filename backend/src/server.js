import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import Redis from 'ioredis';
import { config } from './config.js';
import { initDb, pool, runStockCheck } from './db.js';
import { requireAuth, requireCsrf } from './security.js';
import { createAuthRouter } from './routes/auth.js';
import { createItemsRouter } from './routes/items.js';
import { createCategoriesRouter } from './routes/categories.js';
import { createAnalyticsRouter } from './routes/analytics.js';
import { createRateLimiter } from './middleware/rateLimiter.js';
import { createCacheMiddleware } from './middleware/cache.js';
import { createIdempotencyMiddleware } from './middleware/idempotency.js';

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initDbWithRetry(attempts = 6, delayMs = 2000) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      await initDb();
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[DB] Init attempt ${i}/${attempts} failed: ${err.message}`);
      if (i < attempts) await sleep(delayMs);
    }
  }
  throw lastErr;
}

async function connectRedis() {
  if (!config.redisUrl) return null;
  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    connectTimeout: 5000,
    retryStrategy(times) {
      return Math.min(times * 250, 3000);
    }
  });
  client.on('error', (err) => {
    console.error('[Redis] Connection warning:', err.message);
  });

  try {
    await client.ping();
    console.log('[Redis] Connected and verified.');
    return client;
  } catch (err) {
    console.warn(`[Redis] Unavailable on startup (${err.message}); falling back to in-memory rate limiting.`);
    client.disconnect();
    return null;
  }
}

function makeLimiter(redisClient, { windowMs, max, prefix, message }) {
  const opts = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    passOnStoreError: true,
    message: { error: message }
  };
  if (redisClient) {
    opts.store = new RedisStore({
      prefix,
      sendCommand: (...args) => redisClient.call(...args)
    });
  }
  return rateLimit(opts);
}

function buildApp(redisClient) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const envRateLimit = Number.parseInt(process.env.RATE_LIMIT_MAX ?? '', 10);
  const apiLimiterMax = Number.isFinite(envRateLimit) && envRateLimit > 180 ? envRateLimit : 180;

  const apiLimiter = makeLimiter(redisClient, {
    windowMs: 60 * 1000,
    max: apiLimiterMax,
    prefix: 'rl:api:',
    message: 'Too many requests. Slow down and try again.'
  });

  const authLimiter = makeLimiter(redisClient, {
    windowMs: 15 * 60 * 1000,
    max: 10,
    prefix: 'rl:auth:',
    message: 'Too many authentication attempts. Try again in 15 minutes.'
  });

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    },
    hsts: config.cookieSecure ? { maxAge: 31536000, includeSubDomains: true } : false
  }));

  app.use(cors({
    origin: config.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key']
  }));

  app.use(cookieParser());
  app.use(express.json({ limit: '64kb' }));

  // Health probes (unauthenticated, no rate-limit lockouts)
  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/health/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      if (redisClient) {
        await redisClient.ping();
      }
      return res.json({ status: 'ready' });
    } catch {
      return res.status(503).json({ status: 'not_ready' });
    }
  });

  // Redis-backed global rate limiter (before express-rate-limit)
  app.use(createRateLimiter(redisClient));

  // Apply rate limit and CSRF protection across API routes
  app.use('/api', apiLimiter);
  app.use('/api', requireCsrf);

  // Auth endpoints (public login/register/refresh/status + protected /me & /users)
  app.use('/api/auth', createAuthRouter(authLimiter));

  // Cache middleware for catalog GET routes (applied after auth)
  const cacheItems = createCacheMiddleware(redisClient, { ttlSeconds: 60, prefix: 'cache:' });
  app.get('/api/items', requireAuth, cacheItems);
  app.get('/api/categories', requireAuth, cacheItems);

  // Idempotency middleware for inventory write routes (POST/PATCH)
  app.use('/api', requireAuth, createIdempotencyMiddleware(redisClient));

  // Protected inventory endpoints
  app.use('/api', requireAuth, createItemsRouter(redisClient));
  app.use('/api', requireAuth, createCategoriesRouter(redisClient));
  app.use('/api', requireAuth, createAnalyticsRouter(redisClient));

  // 404 fallback
  app.use((_req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Central error handler (never leaks stack traces in production)
  app.use((err, _req, res, _next) => {
    console.error('[API Error]', err.message);
    res.status(err.status || 500).json({
      error: config.nodeEnv === 'development' ? err.message : 'Internal server error'
    });
  });

  return app;
}

let stockInterval = null;

async function start() {
  await initDbWithRetry();
  await runStockCheck();
  const redisClient = await connectRedis();
  const app = buildApp(redisClient);

  stockInterval = setInterval(() => {
    runStockCheck().catch((err) => console.error('[StockCheck]', err.message));
  }, 6 * 60 * 60 * 1000);

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Smart Inventory API listening on port ${config.port}`);
  });

  const shutdown = async () => {
    clearInterval(stockInterval);
    server.close(async () => {
      await pool.end().catch(() => {});
      if (redisClient) await redisClient.quit().catch(() => {});
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});

start().catch((err) => {
  console.error('Fatal startup error:', err.stack || err.message);
  process.exit(1);
});
