import { Router } from 'express';
import { requireScope } from '../../middleware/apiKeyAuth.js';
import { getMtaAdapter, createAdapter } from '../../services/mta/index.js';
import { insertRows, query } from '../../db/clickhouse.js';
import { genId } from '../../utils/helpers.js';

// ═══════════════════════════════════════════════════════════════
// v1 MTA Endpoints — campaign orchestration through adapters
//
// POST /api/v1/mta/test                  — test MTA connection
// GET  /api/v1/mta/lists                 — get MTA lists
// POST /api/v1/mta/lists                 — create a list
// POST /api/v1/mta/lists/:id/subscribers — push contacts to list
// POST /api/v1/mta/campaigns             — create campaign
// POST /api/v1/mta/campaigns/:id/send    — send campaign
// POST /api/v1/mta/campaigns/:id/pause   — pause campaign
// GET  /api/v1/mta/campaigns/:id/stats   — get campaign stats
// GET  /api/v1/mta/campaigns             — list campaigns
// POST /api/v1/mta/webhooks/setup        — configure MTA webhooks
// ═══════════════════════════════════════════════════════════════

const router = Router();

async function getAdapter(req: any, res: any): Promise<ReturnType<typeof getMtaAdapter> extends Promise<infer T> ? Exclude<T, null> : never> {
  const adapter = await getMtaAdapter();
  if (!adapter) {
    res.status(503).json({
      error: {
        code: 'MTA_NOT_CONFIGURED',
        message: 'No MTA provider configured. Set mta_provider, mta_base_url, mta_api_key in system_config.',
      },
    });
    return null as any;
  }
  return adapter as any;
}

// POST /api/v1/mta/test
router.post('/test', requireScope('webhooks:write'), async (req, res) => {
  try {
    const { provider, base_url, api_key } = req.body;

    const adapter = provider && base_url && api_key
      ? createAdapter(provider, base_url, api_key)
      : await getMtaAdapter();

    if (!adapter) {
      return res.status(503).json({
        error: { code: 'MTA_NOT_CONFIGURED', message: 'No MTA configured or provided' },
      });
    }

    const result = await adapter.testConnection();
    res.json({ data: result });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/mta/lists
router.get('/lists', requireScope('contacts:read'), async (req, res) => {
  try {
    const adapter = await getAdapter(req, res);
    if (!adapter) return;
    const lists = await adapter.getLists();
    res.json({ data: lists });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// POST /api/v1/mta/lists
router.post('/lists', requireScope('contacts:write'), async (req, res) => {
  try {
    const adapter = await getAdapter(req, res);
    if (!adapter) return;
    const { name, defaults } = req.body;
    if (!name) {
      return res.status(400).json({ error: { code: 'VALIDATION', message: 'name is required' } });
    }
    const list = await adapter.createList(name, defaults);
    res.status(201).json({ data: list });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// POST /api/v1/mta/lists/:id/subscribers
router.post('/lists/:id/subscribers', requireScope('contacts:write'), async (req, res) => {
  try {
    const adapter = await getAdapter(req, res);
    if (!adapter) return;
    const { subscribers } = req.body;

    if (!Array.isArray(subscribers) || subscribers.length === 0) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'subscribers[] array is required' },
      });
    }

    if (subscribers.length > 10000) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'Max 10,000 subscribers per batch' },
      });
    }

    const result = await adapter.addSubscribers(String(req.params.id), subscribers);
    res.status(201).json({ data: result });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// POST /api/v1/mta/campaigns
router.post('/campaigns', requireScope('webhooks:write'), async (req, res) => {
  try {
    const adapter = await getAdapter(req, res);
    if (!adapter) return;

    const { name, list_id, subject, from_name, from_email, html_body, plain_text, reply_to } = req.body;

    if (!name || !list_id || !subject || !from_name || !from_email || !html_body) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'name, list_id, subject, from_name, from_email, html_body are required' },
      });
    }

    const campaign = await adapter.createCampaign({
      name, list_id, subject, from_name, from_email, html_body, plain_text, reply_to,
    });

    // Track in our campaigns table
    await insertRows('campaigns', [{
      id: genId(),
      name,
      mta_provider: adapter.provider,
      mta_campaign_id: campaign.id,
      mta_list_id: list_id,
      subject,
      from_name,
      from_email,
      status: 'draft',
    }]);

    res.status(201).json({ data: campaign });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// POST /api/v1/mta/campaigns/:id/send
router.post('/campaigns/:id/send', requireScope('webhooks:write'), async (req, res) => {
  try {
    const adapter = await getAdapter(req, res);
    if (!adapter) return;

    const campaignId = String(req.params.id);
    const result = await adapter.sendCampaign(campaignId);

    // Update campaign status
    if (result.sent) {
      const rows = await query<{ id: string }>(
        `SELECT id FROM campaigns FINAL WHERE mta_campaign_id = '${campaignId.replace(/'/g, "\\'")}' LIMIT 1`,
      );
      if (rows.length > 0) {
        await insertRows('campaigns', [{
          ...rows[0],
          status: 'sending',
          updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
        }]);
      }
    }

    res.json({ data: result });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// POST /api/v1/mta/campaigns/:id/pause
router.post('/campaigns/:id/pause', requireScope('webhooks:write'), async (req, res) => {
  try {
    const adapter = await getAdapter(req, res);
    if (!adapter) return;
    const result = await adapter.pauseCampaign(String(req.params.id));
    res.json({ data: result });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/mta/campaigns/:id/stats
router.get('/campaigns/:id/stats', requireScope('stats:read'), async (req, res) => {
  try {
    const adapter = await getAdapter(req, res);
    if (!adapter) return;
    const stats = await adapter.getCampaignStats(String(req.params.id));
    res.json({ data: stats });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/mta/campaigns
router.get('/campaigns', requireScope('stats:read'), async (req, res) => {
  try {
    const adapter = await getAdapter(req, res);
    if (!adapter) return;
    const page = Number(req.query.page) || 1;
    const perPage = Number(req.query.per_page) || 50;
    const campaigns = await adapter.getCampaigns(page, perPage);
    res.json({ data: campaigns });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// POST /api/v1/mta/webhooks/setup
router.post('/webhooks/setup', requireScope('webhooks:write'), async (req, res) => {
  try {
    const adapter = await getAdapter(req, res);
    if (!adapter) return;

    const { base_url } = req.body;
    if (!base_url) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'base_url (your Refinery API URL) is required' },
      });
    }

    const result = await adapter.setupWebhooks(base_url);
    res.json({ data: result });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

export default router;
