import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

// ═══════════════════════════════════════════════════════════════
// Rate Limiter — per API key, applied to v1 endpoints
// Default: 60 req/min, overridden by key's rate_limit_rpm
// ═══════════════════════════════════════════════════════════════

export const apiKeyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: (req: Request) => {
    return req.apiKey?.rate_limit_rpm || 60;
  },
  keyGenerator: (req: Request) => {
    const apiKey = req.apiKey;
    if (apiKey?.key_prefix) return `apikey:${apiKey.key_prefix}`;
    const authHeader = req.headers.authorization || '';
    return `bearer:${authHeader.slice(0, 20)}`;
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Check X-RateLimit-* headers for limits.',
    },
  },
});
