/**
 * Redis-backed sliding window rate limiter middleware.
 * Fail-open: if Redis is unavailable the request passes through.
 */
export function createRateLimiter(redisClient, { maxRequests = 100, windowSeconds = 60 } = {}) {
  return async (req, res, next) => {
    if (!redisClient) return next();

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `ratelimit:${ip}`;

    try {
      const results = await redisClient
        .multi()
        .incr(key)
        .expire(key, windowSeconds)
        .exec();

      // ioredis multi().exec() returns [[err, val], ...] or null on EXECABORT
      if (!results) return next();

      const [incrErr, count] = results[0];
      if (incrErr) return next();          // fail-open

      if (count > maxRequests) {
        const ttl = await redisClient.ttl(key);
        const retryAfter = ttl > 0 ? ttl : windowSeconds;
        res.set('Retry-After', String(retryAfter));
        return res.status(429).json({
          error: 'Rate limit exceeded. Try again later.',
          retryAfter
        });
      }

      return next();
    } catch {
      // Redis unavailable — fail-open
      return next();
    }
  };
}
