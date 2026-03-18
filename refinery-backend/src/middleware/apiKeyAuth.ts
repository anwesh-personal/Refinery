import { Request, Response, NextFunction } from 'express';
import { validateApiKey, hasScope, type ApiKeyRecord, type ApiKeyScope } from '../services/apiKeys.js';

// ═══════════════════════════════════════════════════════════════
// API Key Auth Middleware — for machine-to-machine v1 endpoints
// Expects: Authorization: Bearer rnx_live_xxx or rnx_test_xxx
// ═══════════════════════════════════════════════════════════════

declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKeyRecord;
    }
  }
}

/** Validates API key and attaches the key record to req.apiKey */
export const requireApiKey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Missing Authorization: Bearer <api_key> header' },
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token.startsWith('rnx_')) {
      return res.status(401).json({
        error: { code: 'INVALID_KEY', message: 'API key must start with rnx_live_ or rnx_test_' },
      });
    }

    const keyRecord = await validateApiKey(token);
    if (!keyRecord) {
      return res.status(401).json({
        error: { code: 'INVALID_KEY', message: 'Invalid, revoked, or expired API key' },
      });
    }

    req.apiKey = keyRecord;
    next();
  } catch (err: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  }
};

/** Factory: returns middleware that checks for a specific scope */
export function requireScope(scope: ApiKeyScope) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'API key required' },
      });
    }

    if (!hasScope(req.apiKey, scope)) {
      return res.status(403).json({
        error: { code: 'FORBIDDEN', message: `Missing required scope: ${scope}` },
      });
    }

    next();
  };
}
