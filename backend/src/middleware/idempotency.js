/**
 * Idempotency middleware for POST and PATCH requests.
 * Requires an `Idempotency-Key` header; caches the response in Redis for 24 h.
 * Fail-open: if Redis is unavailable the request proceeds normally.
 */
const TTL_SECONDS = 86400; // 24 hours

export function createIdempotencyMiddleware(redisClient) {
  return async (req, res, next) => {
    if (req.method !== 'POST' && req.method !== 'PATCH') return next();

    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey) {
      return res.status(400).json({
        error: 'Idempotency-Key header is required for POST and PATCH requests'
      });
    }

    if (!redisClient) return next();

    const redisKey = `idempotency:${idempotencyKey}`;

    try {
      const cached = await redisClient.get(redisKey);

      if (cached) {
        const { statusCode, body } = JSON.parse(cached);
        return res.status(statusCode).json(body);
      }

      // Monkey-patch res.json() to intercept the response
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        const statusCode = res.statusCode || 200;
        // Store in Redis (fire-and-forget; don't block the response)
        redisClient
          .set(redisKey, JSON.stringify({ statusCode, body }), 'EX', TTL_SECONDS)
          .catch(() => {});
        return originalJson(body);
      };

      return next();
    } catch {
      // Redis unavailable — skip idempotency
      return next();
    }
  };
}
