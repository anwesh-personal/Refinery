import { Router } from 'express';
import { storeEvent, type EventType, type EngagementEvent } from '../../services/engagement.js';

// ═══════════════════════════════════════════════════════════════
// Public MTA Webhook Receiver — no API key required
// MailWizz (or other EMAs) POST events directly to these URLs.
// Each provider has its own normalizer to unify the payload.
//
// POST /api/v1/webhooks/mta/mailwizz
// POST /api/v1/webhooks/mta/sendgrid
// POST /api/v1/webhooks/mta/generic
// ═══════════════════════════════════════════════════════════════

const router = Router();

// ─── MailWizz webhook normalizer ───
router.post('/mailwizz', async (req, res) => {
  try {
    const body = req.body;
    // MailWizz sends different payloads for different event types
    // Common fields: subscriber.email, campaign.campaign_uid
    const email = body?.subscriber?.email || body?.email || body?.EMAIL || '';
    const campaignId = body?.campaign?.campaign_uid || body?.campaign_uid || body?.campaign_id || '';

    if (!email) {
      return res.status(400).json({ error: 'No email in payload' });
    }

    let eventType: EventType = 'open';
    let bounceType: string | undefined;
    let bounceReason: string | undefined;

    // Determine event type from MailWizz's notification_type or event field
    const notifType = (body?.notification_type || body?.event || body?.type || '').toLowerCase();

    if (notifType.includes('bounce') || notifType === 'hard_bounce' || notifType === 'soft_bounce') {
      eventType = 'bounce';
      bounceType = notifType.includes('hard') ? 'hard' : 'soft';
      bounceReason = body?.bounce_reason || body?.reason || body?.message || '';
    } else if (notifType.includes('complaint') || notifType === 'spam') {
      eventType = 'complaint';
    } else if (notifType.includes('unsubscribe') || notifType === 'unsubscribe') {
      eventType = 'unsubscribe';
    } else if (notifType.includes('click')) {
      eventType = 'click';
    } else if (notifType.includes('open')) {
      eventType = 'open';
    }

    const event: EngagementEvent = {
      event_type: eventType,
      email: email.toLowerCase().trim(),
      campaign_id: campaignId,
      list_id: body?.list?.list_uid || body?.list_id || null,
      mta_provider: 'mailwizz',
      bounce_type: bounceType as any,
      bounce_reason: bounceReason,
      link_url: body?.url || body?.link || null,
      user_agent: body?.user_agent || req.headers['user-agent'] || null,
      ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || '',
      raw_payload: JSON.stringify(body),
      event_id: body?.event_id || body?.message_id || null,
    };

    const stored = await storeEvent(event);
    res.status(stored ? 201 : 200).json({
      status: stored ? 'stored' : 'duplicate',
      event_type: eventType,
    });
  } catch (e: any) {
    console.error('[Webhook/mailwizz]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── SendGrid Event Webhook normalizer ───
router.post('/sendgrid', async (req, res) => {
  try {
    // SendGrid sends an array of events
    const events = Array.isArray(req.body) ? req.body : [req.body];
    let stored = 0;
    let skipped = 0;

    for (const body of events) {
      const email = (body?.email || '').toLowerCase().trim();
      if (!email) { skipped++; continue; }

      const sgEvent = (body?.event || '').toLowerCase();
      let eventType: EventType = 'open';
      let bounceType: string | undefined;

      if (sgEvent === 'bounce' || sgEvent === 'dropped') {
        eventType = 'bounce';
        bounceType = body?.type === 'bounce' ? 'hard' : 'soft';
      } else if (sgEvent === 'spamreport') {
        eventType = 'complaint';
      } else if (sgEvent === 'unsubscribe' || sgEvent === 'group_unsubscribe') {
        eventType = 'unsubscribe';
      } else if (sgEvent === 'click') {
        eventType = 'click';
      } else if (sgEvent === 'open') {
        eventType = 'open';
      } else {
        skipped++; continue;
      }

      const event: EngagementEvent = {
        event_type: eventType,
        email,
        campaign_id: body?.sg_message_id || null,
        mta_provider: 'sendgrid',
        bounce_type: bounceType as any,
        bounce_reason: body?.reason || body?.response || null,
        link_url: body?.url || null,
        user_agent: body?.useragent || null,
        ip_address: body?.ip || '',
        raw_payload: JSON.stringify(body),
        event_id: body?.sg_event_id || null,
      };

      const result = await storeEvent(event);
      if (result) stored++; else skipped++;
    }

    res.status(201).json({ stored, skipped });
  } catch (e: any) {
    console.error('[Webhook/sendgrid]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Generic fallback (any provider posting standard fields) ───
router.post('/generic', async (req, res) => {
  try {
    const body = req.body;
    const email = (body?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'email is required' });

    const validTypes = new Set<EventType>(['bounce', 'open', 'click', 'reply', 'complaint', 'unsubscribe']);
    const eventType = validTypes.has(body?.event_type) ? body.event_type : 'open';

    const event: EngagementEvent = {
      event_type: eventType,
      email,
      campaign_id: body?.campaign_id || undefined,
      list_id: body?.list_id || undefined,
      mta_provider: body?.provider || 'generic',
      bounce_type: body?.bounce_type || undefined,
      bounce_reason: body?.bounce_reason || undefined,
      link_url: body?.url || undefined,
      user_agent: req.headers['user-agent'] || undefined,
      ip_address: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || '',
      raw_payload: JSON.stringify(body),
      event_id: body?.event_id || null,
    };

    const stored = await storeEvent(event);
    res.status(stored ? 201 : 200).json({ status: stored ? 'stored' : 'duplicate' });
  } catch (e: any) {
    console.error('[Webhook/generic]', e.message);
    res.status(500).json({ error: e.message });
  }
});

export default router;
