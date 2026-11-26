/**
 * Cache-aside middleware for GET routes.
 * Stores JSON responses in Redis with a configurable TTL.
 * Fail-open: if Redis is unavailable the request proceeds without caching.
 */
export function createCacheMiddleware(redisClient, { ttlSeconds = 60, prefix = 'cache:' } = {}) {
  return async (req, res, next) => {
    if (!redisClient) return next();

    const cacheKey = `${prefix}${req.originalUrl}`;

    try {
      const cached = await redisClient.get(cacheKey);

      if (cached) {
        res.set('X-Cache', 'HIT');
        return res.json(JSON.parse(cached));
      }

      // Cache miss — monkey-patch res.json() to store the result
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        res.set('X-Cache', 'MISS');
        // Store in Redis (fire-and-forget)
        redisClient
          .set(cacheKey, JSON.stringify(body), 'EX', ttlSeconds)
          .catch(() => {});
        return originalJson(body);
      };

      return next();
    } catch {
      // Redis unavailable — skip caching
      return next();
    }
  };
}
