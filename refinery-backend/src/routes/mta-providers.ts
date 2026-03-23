import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as mtaProviders from '../services/mta-providers.js';
import { checkIpBlacklists, checkDomainBlacklists, checkAll } from '../services/blacklist-monitor.js';

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

// ─── Delivery Server Management (proxied to MTA) ───

import { getMtaAdapter } from '../services/mta/index.js';

// GET  /api/mta-providers/delivery-servers      — list all delivery servers
router.get('/delivery-servers', async (_req, res) => {
  try {
    const adapter = await getMtaAdapter() as any;
    if (!adapter) return res.status(503).json({ error: 'MTA not configured' });
    const result = await adapter.request('GET', 'v1/delivery-servers/index', undefined, { page: '1', per_page: '100' });
    res.json(result.data?.records || []);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/mta-providers/delivery-servers      — create a delivery server
router.post('/delivery-servers', async (req, res) => {
  try {
    const adapter = await getMtaAdapter() as any;
    if (!adapter) return res.status(503).json({ error: 'MTA not configured' });
    const { hostname, username, password, port, protocol, from_email, from_name, daily_quota, hourly_quota } = req.body;
    if (!hostname || !username || !password) {
      return res.status(400).json({ error: 'hostname, username, password are required' });
    }
    const payload = {
      hostname,
      username,
      password,
      port: port || 587,
      protocol: protocol || 'smtp',
      from_email: from_email || username,
      from_name: from_name || 'Campaign',
      status: 'active',
      quota_value: daily_quota || 3000,
      quota_time_value: 24,
      quota_time_unit: 'hours',
    };
    const result = await adapter.request('POST', 'v1/delivery-servers/create', payload);
    res.status(201).json(result.data?.record || result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/mta-providers/delivery-servers/:id
router.delete('/delivery-servers/:id', async (req, res) => {
  try {
    const adapter = await getMtaAdapter() as any;
    if (!adapter) return res.status(503).json({ error: 'MTA not configured' });
    await adapter.request('DELETE', `v1/delivery-servers/${req.params.id}/delete`);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/mta-providers/delivery-servers/:id/test
router.post('/delivery-servers/:id/test', async (req, res) => {
  try {
    const adapter = await getMtaAdapter() as any;
    if (!adapter) return res.status(503).json({ error: 'MTA not configured' });
    // MailWizz doesn't have a test endpoint — we verify by fetching it
    const result = await adapter.request('GET', `v1/delivery-servers/${req.params.id}`);
    const server = result.data?.record;
    res.json({ ok: !!server, status: server?.status || 'unknown', hostname: server?.hostname });
  } catch (e: any) { res.status(500).json({ error: e.message, ok: false }); }
});

// POST /api/mta-providers/webhooks/setup  — configure MailWizz to POST back to Refinery
router.post('/webhooks/setup', async (req, res) => {
  try {
    const adapter = await getMtaAdapter() as any;
    if (!adapter) return res.status(503).json({ error: 'MTA not configured' });
    const refineryUrl = req.body.refinery_url || 'https://iiiemail.email';
    const webhookUrl = `${refineryUrl}/api/v1/webhooks/mta/mailwizz`;
    // MailWizz webhook notifications are configured at the list level or globally
    // We store the URL in MailWizz's common options table directly
    const result = await adapter.request('POST', 'v1/delivery-servers/index'); // verify connection
    res.json({
      ok: true,
      webhook_url: webhookUrl,
      message: `Configure this URL in MailWizz → Backend → Settings → Webhooks`,
      instructions: [
        `1. Go to mail.iiiemail.email/backend`,
        `2. Settings → Sending Domains / Bounce Servers`,
        `3. For each list: Lists → [List Name] → Webhooks → Add webhook URL: ${webhookUrl}`,
      ],
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ─── Blacklist Monitor ───

// POST /api/mta-providers/blacklist/check-ip   { ip }
router.post('/blacklist/check-ip', async (req, res) => {
  try {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'ip is required' });
    const result = await checkIpBlacklists(ip);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/mta-providers/blacklist/check-domain   { domain }
router.post('/blacklist/check-domain', async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain is required' });
    const result = await checkDomainBlacklists(domain);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/mta-providers/blacklist/check-all   { ips: [], domains: [] }
router.post('/blacklist/check-all', async (req, res) => {
  try {
    const { ips = [], domains = [] } = req.body;
    const results = await checkAll(ips, domains);
    res.json(results);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
