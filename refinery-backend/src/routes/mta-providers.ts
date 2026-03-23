import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as mtaProviders from '../services/mta-providers.js';

// ═══════════════════════════════════════════════════════════════
// MTA Provider Management Routes — UI-driven, no hardcoding
//
// GET    /api/mta-providers                    — list all providers
// POST   /api/mta-providers                    — add a new provider
// PUT    /api/mta-providers/:id                — update a provider
// DELETE /api/mta-providers/:id                — remove a provider
// POST   /api/mta-providers/:id/test           — test connection
// GET    /api/mta-providers/domains            — list all sending domains
// GET    /api/mta-providers/:id/domains        — list domains for provider
// POST   /api/mta-providers/:id/domains        — add a sending domain
// DELETE /api/mta-providers/domains/:domainId  — remove a domain
// POST   /api/mta-providers/domains/:domainId/check-dns — DNS health check
// ═══════════════════════════════════════════════════════════════

const router = Router();

router.use(requireAuth);

// Bootstrap tables on first load
let tablesReady = false;
router.use(async (_req, _res, next) => {
  if (!tablesReady) {
    await mtaProviders.ensureTables().catch(e => console.error('[MTA Tables]', e.message));
    tablesReady = true;
  }
  next();
});

// ─── Providers ───

router.get('/', async (_req, res) => {
  try {
    const providers = await mtaProviders.listProviders();
    res.json(providers);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, provider_type, base_url, api_key, is_default } = req.body;
    if (!name || !provider_type || !base_url || !api_key) {
      return res.status(400).json({ error: 'name, provider_type, base_url, and api_key are required' });
    }
    const id = await mtaProviders.createProvider({ name, provider_type, base_url, api_key, is_default });
    res.status(201).json({ id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    await mtaProviders.updateProvider(req.params.id, req.body);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await mtaProviders.deleteProvider(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/test', async (req, res) => {
  try {
    const result = await mtaProviders.testProvider(req.params.id);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Sending Domains ───

router.get('/domains', async (_req, res) => {
  try {
    const domains = await mtaProviders.listDomains();
    res.json(domains);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:id/domains', async (req, res) => {
  try {
    const domains = await mtaProviders.listDomains(req.params.id);
    res.json(domains);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/domains', async (req, res) => {
  try {
    const { domain, from_email, from_name } = req.body;
    if (!domain || !from_email) {
      return res.status(400).json({ error: 'domain and from_email are required' });
    }
    const id = await mtaProviders.createDomain({
      provider_id: req.params.id,
      domain,
      from_email,
      from_name,
    });
    res.status(201).json({ id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/domains/:domainId', async (req, res) => {
  try {
    await mtaProviders.deleteDomain(req.params.domainId);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/domains/:domainId/check-dns', async (req, res) => {
  try {
    const result = await mtaProviders.checkDomainDNS(req.params.domainId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
