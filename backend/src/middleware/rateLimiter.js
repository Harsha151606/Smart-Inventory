/**
 * Redis-backed sliding window rate limiter middleware.
 * Reads limit from process.env.RATE_LIMIT_MAX (defaults to 100).
 * Fail-open: if Redis is unavailable the request passes through.
 */
export function createRateLimiter(redisClient, { maxRequests, windowSeconds = 60 } = {}) {
  return async (req, res, next) => {
    if (!redisClient) return next();

    const envMax = Number.parseInt(process.env.RATE_LIMIT_MAX ?? '', 10);
    const limit = maxRequests ?? (Number.isFinite(envMax) && envMax > 0 ? envMax : 1000);

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

      if (count > limit) {
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
