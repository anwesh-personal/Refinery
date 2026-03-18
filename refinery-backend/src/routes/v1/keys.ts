import { Router } from 'express';
import { requireAuth, requireSuperadmin } from '../../middleware/auth.js';
import * as apiKeyService from '../../services/apiKeys.js';
import type { ApiKeyScope } from '../../services/apiKeys.js';

// ═══════════════════════════════════════════════════════════════
// API Key Management — Supabase-auth protected (admin UI)
// POST   /api/v1/keys          — create a new key
// GET    /api/v1/keys          — list your keys
// GET    /api/v1/keys/all      — list all keys (superadmin)
// DELETE /api/v1/keys/:id      — revoke a key
// GET    /api/v1/keys/scopes   — list available scopes
// ═══════════════════════════════════════════════════════════════

const router = Router();

router.use(requireAuth);

router.post('/', async (req, res) => {
  try {
    const { name, scopes, environment, rateLimitRpm, expiresAt } = req.body;

    if (!name || !scopes || !Array.isArray(scopes) || scopes.length === 0) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'name and scopes[] are required' },
      });
    }

    const invalidScopes = scopes.filter((s: string) => !apiKeyService.ALL_SCOPES.includes(s as ApiKeyScope));
    if (invalidScopes.length > 0) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: `Invalid scopes: ${invalidScopes.join(', ')}` },
      });
    }

    const result = await apiKeyService.createApiKey({
      name,
      ownerId: (req as any).userId,
      scopes,
      environment: environment || 'live',
      rateLimitRpm: rateLimitRpm || 60,
      expiresAt,
    });

    res.status(201).json({
      data: result,
      _warning: 'Store this key securely. It will not be shown again.',
    });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

router.get('/', async (req, res) => {
  try {
    const keys = await apiKeyService.listApiKeys((req as any).userId);
    res.json({ data: keys });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

router.get('/all', requireSuperadmin, async (_req, res) => {
  try {
    const keys = await apiKeyService.listAllApiKeys();
    res.json({ data: keys });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const ok = await apiKeyService.revokeApiKey(req.params.id, (req as any).userId);
    if (!ok) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Key not found' } });
    res.json({ data: { revoked: true } });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

router.get('/scopes', (_req, res) => {
  res.json({ data: apiKeyService.ALL_SCOPES });
});

export default router;
