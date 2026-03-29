import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as smtp from '../services/smtp-servers.js';

// ═══════════════════════════════════════════════════════════════
// SMTP Server Routes — YOUR delivery infrastructure
// Stored locally in ClickHouse (not proxied to MailWizz).
// Real SMTP handshake testing: EHLO → STARTTLS → AUTH LOGIN
// ═══════════════════════════════════════════════════════════════

const router = Router();
router.use(requireAuth);

// GET /api/smtp-servers — list all
router.get('/', async (_req, res) => {
  try {
    const servers = await smtp.listServers();
    res.json({ servers });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/smtp-servers — create
router.post('/', async (req, res) => {
  try {
    const { label, hostname, port, protocol, username, password, from_email, from_name, daily_quota } = req.body;
    if (!hostname || !username || !password) {
      return res.status(400).json({ error: 'hostname, username, and password are required' });
    }
    const id = await smtp.createServer({
      label: label || hostname,
      hostname, port, protocol, username, password,
      from_email, from_name, daily_quota,
    });
    res.status(201).json({ id });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUT /api/smtp-servers/:id — update
router.put('/:id', async (req, res) => {
  try {
    await smtp.updateServer(req.params.id, req.body);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/smtp-servers/:id — delete
router.delete('/:id', async (req, res) => {
  try {
    await smtp.deleteServer(req.params.id);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/smtp-servers/:id/test — real SMTP handshake test
router.post('/:id/test', async (req, res) => {
  try {
    const result = await smtp.testServer(req.params.id);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/smtp-servers/:id/push-to-ema — register on a specific EMA provider
// Body: { provider_id: string, daily_quota?: number }
router.post('/:id/push-to-ema', async (req, res) => {
  try {
    const server = await smtp.getServer(req.params.id);
    if (!server) return res.status(404).json({ error: 'SMTP server not found' });

    const { provider_id, daily_quota } = req.body;
    if (!provider_id) return res.status(400).json({ error: 'provider_id is required' });

    // Dynamic: load the specific MTA provider and create its adapter
    const { getProviderRaw } = await import('../services/mta-providers.js');
    const { createAdapter } = await import('../services/mta/index.js');

    const provider = await getProviderRaw(provider_id);
    if (!provider) return res.status(404).json({ error: 'MTA provider not found' });

    const adapter = createAdapter(provider.provider_type, provider.base_url, provider.api_key);

    const result = await adapter.registerDeliveryServer({
      hostname: server.hostname,
      username: server.username,
      password: server.password,
      port: server.port,
      protocol: server.protocol,
      from_email: server.from_email,
      from_name: server.from_name,
      daily_quota: daily_quota ?? server.daily_quota,
    });

    res.json({
      ok: true,
      provider_name: provider.name,
      provider_type: provider.provider_type,
      remote_server: result,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
