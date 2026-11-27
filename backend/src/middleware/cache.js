/**
 * Cache-aside middleware for GET routes.
 * Stores JSON responses in Redis with a configurable TTL.
 * Honors process.env.DISABLE_CACHE (defaults to false) to bypass Redis caching.
 * Fail-open: if Redis is unavailable the request proceeds without caching.
 */
export function createCacheMiddleware(redisClient, { ttlSeconds = 60, prefix = 'cache:' } = {}) {
  return async (req, res, next) => {
    const disableCache = ['true', '1'].includes(String(process.env.DISABLE_CACHE || 'false').toLowerCase());
    if (disableCache) {
      res.set('X-Cache', 'BYPASS');
      return next();
    }
    if (!redisClient) return next();

    const cacheKey = `${prefix}${req.originalUrl}`;

    try {
      const cached = await redisClient.get(cacheKey);

      if (cached) {
        res.set('X-Cache', 'HIT');
        return res.json(JSON.parse(cached));
      }

      // Cache miss — monkey-patch res.json() to store 2xx results
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        res.set('X-Cache', 'MISS');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redisClient
            .set(cacheKey, JSON.stringify(body), 'EX', ttlSeconds)
            .catch(() => {});
        }
        return originalJson(body);
      };

      return next();
    } catch {
      // Redis unavailable — skip caching
      return next();
    }
  };
}

async function deleteMatchingKeys(redisClient, pattern) {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redisClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  } while (cursor !== '0');
}

/**
 * Invalidate all cached catalog, category, and analytics Redis keys.
 * Fail-open: logs a warning if Redis is unavailable without breaking the HTTP response.
 */
export async function invalidateInventoryCache(redisClient, { prefix = 'cache:' } = {}) {
  if (!redisClient) return;
  const patterns = [
    `${prefix}/api/items*`,
    `${prefix}/api/categories*`,
    `${prefix}/api/analytics*`,
    `${prefix}/api/vehicles*`,
    `${prefix}/api/deliveries*`
  ];
  try {
    await Promise.all(patterns.map((pattern) => deleteMatchingKeys(redisClient, pattern)));
  } catch (err) {
    console.warn('[Cache] Invalidation warning:', err.message);
  }
}
