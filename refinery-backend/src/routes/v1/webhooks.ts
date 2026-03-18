import { Router } from 'express';
import { requireScope } from '../../middleware/apiKeyAuth.js';
import { storeEvent, storeBatch, queryEvents, type EventType, type EngagementEvent } from '../../services/engagement.js';

// ═══════════════════════════════════════════════════════════════
// v1 Webhook Receivers — ingest engagement data from MTAs
//
// POST /api/v1/webhooks/bounce        — hard/soft bounce
// POST /api/v1/webhooks/open          — email opened
// POST /api/v1/webhooks/click         — link clicked
// POST /api/v1/webhooks/reply         — reply received
// POST /api/v1/webhooks/complaint     — spam complaint
// POST /api/v1/webhooks/unsubscribe   — unsubscribe
// POST /api/v1/webhooks/batch         — batch of mixed events
// GET  /api/v1/webhooks/events        — query stored events
// ═══════════════════════════════════════════════════════════════

const router = Router();

function extractIp(req: any): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || '';
}

function buildEvent(eventType: EventType, body: Record<string, any>, req: any): EngagementEvent {
  return {
    event_type: eventType,
    email: String(body.email || '').toLowerCase().trim(),
    campaign_id: body.campaign_id || body.campaignId || null,
    list_id: body.list_id || body.listId || null,
    mta_provider: body.mta_provider || body.provider || 'mailwizz',
    bounce_type: body.bounce_type || body.bounceType || null,
    bounce_reason: body.bounce_reason || body.bounceReason || body.reason || null,
    link_url: body.link_url || body.url || null,
    user_agent: body.user_agent || req.headers['user-agent'] || null,
    ip_address: body.ip_address || extractIp(req),
    raw_payload: JSON.stringify(body),
    event_id: body.event_id || body.eventId || body.message_id || null,
  };
}

function createEventHandler(eventType: EventType) {
  return async (req: any, res: any) => {
    try {
      const event = buildEvent(eventType, req.body, req);

      if (!event.email) {
        return res.status(400).json({
          error: { code: 'VALIDATION', message: 'email is required' },
        });
      }

      const stored = await storeEvent(event);

      if (!stored) {
        return res.json({ data: { status: 'duplicate', event_type: eventType } });
      }

      res.status(201).json({
        data: { status: 'stored', id: stored.id, event_type: eventType, up_id: stored.up_id },
      });
    } catch (e: any) {
      console.error(`[Webhook/${eventType}]`, e.message);
      res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
    }
  };
}

// Individual event endpoints
router.post('/bounce', requireScope('webhooks:write'), createEventHandler('bounce'));
router.post('/open', requireScope('webhooks:write'), createEventHandler('open'));
router.post('/click', requireScope('webhooks:write'), createEventHandler('click'));
router.post('/reply', requireScope('webhooks:write'), createEventHandler('reply'));
router.post('/complaint', requireScope('webhooks:write'), createEventHandler('complaint'));
router.post('/unsubscribe', requireScope('webhooks:write'), createEventHandler('unsubscribe'));

// POST /api/v1/webhooks/batch — ingest a batch of mixed event types
router.post('/batch', requireScope('webhooks:write'), async (req, res) => {
  try {
    const { events } = req.body;

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'events[] array is required' },
      });
    }

    if (events.length > 5000) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'Max 5,000 events per batch' },
      });
    }

    const VALID_TYPES = new Set<EventType>(['bounce', 'open', 'click', 'reply', 'complaint', 'unsubscribe']);

    const mapped: EngagementEvent[] = [];
    const errors: Array<{ index: number; reason: string }> = [];

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!ev.email) { errors.push({ index: i, reason: 'missing email' }); continue; }
      if (!ev.event_type || !VALID_TYPES.has(ev.event_type)) {
        errors.push({ index: i, reason: `invalid event_type: ${ev.event_type}` });
        continue;
      }
      mapped.push(buildEvent(ev.event_type, ev, req));
    }

    const result = await storeBatch(mapped);

    res.status(201).json({
      data: {
        stored: result.stored,
        duplicates: result.duplicates,
        rejected: errors.length,
        errors: errors.length > 0 ? errors.slice(0, 50) : undefined,
      },
    });
  } catch (e: any) {
    console.error('[Webhook/batch]', e.message);
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/webhooks/events — query stored engagement events
router.get('/events', requireScope('stats:read'), async (req, res) => {
  try {
    const { event_type, email, campaign_id, mta_provider, since, until, limit, offset } = req.query;

    const result = await queryEvents({
      event_type: event_type as EventType | undefined,
      email: email as string | undefined,
      campaign_id: campaign_id as string | undefined,
      mta_provider: mta_provider as string | undefined,
      since: since as string | undefined,
      until: until as string | undefined,
      limit: Number(limit) || 100,
      offset: Number(offset) || 0,
    });

    res.json({
      data: result.data,
      meta: { total: result.total },
    });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

export default router;
