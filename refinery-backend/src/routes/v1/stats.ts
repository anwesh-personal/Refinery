import { Router } from 'express';
import { requireScope } from '../../middleware/apiKeyAuth.js';
import {
  getDeliverabilityStats,
  getEngagementStats,
  getCampaignPerformance,
  getContactScores,
} from '../../services/stats.js';

// ═══════════════════════════════════════════════════════════════
// v1 Stats Endpoints — aggregated intelligence for MarketerX brain
//
// GET /api/v1/stats/deliverability   — bounce rates, domain health
// GET /api/v1/stats/engagement       — opens, clicks, timing, top links
// GET /api/v1/stats/campaigns        — per-campaign performance
// GET /api/v1/stats/scores           — per-contact engagement scores
// GET /api/v1/stats/overview         — combined high-level dashboard
// ═══════════════════════════════════════════════════════════════

const router = Router();

// GET /api/v1/stats/deliverability
router.get('/deliverability', requireScope('stats:read'), async (req, res) => {
  try {
    const { campaign_id, mta_provider, since, until } = req.query;

    const stats = await getDeliverabilityStats({
      campaign_id: campaign_id as string | undefined,
      mta_provider: mta_provider as string | undefined,
      since: since as string | undefined,
      until: until as string | undefined,
    });

    res.json({ data: stats });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/stats/engagement
router.get('/engagement', requireScope('stats:read'), async (req, res) => {
  try {
    const { campaign_id, mta_provider, since, until } = req.query;

    const stats = await getEngagementStats({
      campaign_id: campaign_id as string | undefined,
      mta_provider: mta_provider as string | undefined,
      since: since as string | undefined,
      until: until as string | undefined,
    });

    res.json({ data: stats });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/stats/campaigns
router.get('/campaigns', requireScope('stats:read'), async (req, res) => {
  try {
    const { since, limit } = req.query;

    const campaigns = await getCampaignPerformance({
      since: since as string | undefined,
      limit: Number(limit) || 50,
    });

    res.json({ data: campaigns });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/stats/scores — per-contact engagement scoring
router.get('/scores', requireScope('stats:read'), async (req, res) => {
  try {
    const { segment_id, min_score, limit } = req.query;

    const scores = await getContactScores({
      segment_id: segment_id as string | undefined,
      min_score: min_score ? Number(min_score) : undefined,
      limit: Number(limit) || 100,
    });

    res.json({ data: scores });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/stats/overview — combined high-level snapshot
router.get('/overview', requireScope('stats:read'), async (req, res) => {
  try {
    const { since, until } = req.query;
    const timeFilters = {
      since: since as string | undefined,
      until: until as string | undefined,
    };

    const [deliverability, engagement] = await Promise.all([
      getDeliverabilityStats(timeFilters),
      getEngagementStats(timeFilters),
    ]);

    res.json({
      data: {
        deliverability: {
          delivery_rate: deliverability.delivery_rate,
          bounce_rate: deliverability.bounce_rate,
          complaint_rate: deliverability.complaint_rate,
          total_sent: deliverability.total_sent,
        },
        engagement: {
          open_rate: engagement.open_rate,
          click_rate: engagement.click_rate,
          reply_rate: engagement.reply_rate,
          click_to_open_rate: engagement.click_to_open_rate,
        },
        health: deriveHealthGrade(deliverability.delivery_rate, deliverability.complaint_rate),
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

function deriveHealthGrade(deliveryRate: number, complaintRate: number): {
  grade: string;
  label: string;
  action: string;
} {
  if (deliveryRate >= 98 && complaintRate < 0.05) {
    return { grade: 'A', label: 'Excellent', action: 'Keep current strategy' };
  }
  if (deliveryRate >= 95 && complaintRate < 0.1) {
    return { grade: 'B', label: 'Good', action: 'Monitor bounce sources' };
  }
  if (deliveryRate >= 90 && complaintRate < 0.3) {
    return { grade: 'C', label: 'Fair', action: 'Increase verification, check content quality' };
  }
  if (deliveryRate >= 80) {
    return { grade: 'D', label: 'Poor', action: 'Pause campaigns, deep-clean list, re-verify all contacts' };
  }
  return { grade: 'F', label: 'Critical', action: 'STOP all sends. Full list audit required. Domain reputation at risk.' };
}

export default router;
