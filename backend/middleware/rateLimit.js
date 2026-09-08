const buckets = new Map();
const MAX_BUCKETS = 10_000;

function removeExpiredBuckets(now) {
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}

function rateLimit({ windowMs = 60_000, max = 30, keyPrefix = 'global' } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      if (buckets.size >= MAX_BUCKETS) removeExpiredBuckets(now);
      if (buckets.size >= MAX_BUCKETS) {
        return res.status(429).json({ message: 'Too many requests. Try again later.' });
      }
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ message: 'Too many requests. Try again later.' });
    }

    return next();
  };
}

module.exports = rateLimit;
