import { Router } from 'express';
import * as dashboardService from '../services/dashboard.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// GET /api/dashboard/ingestion-trends?days=30
router.get('/ingestion-trends', async (req, res) => {
    try {
        const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
        const data = await dashboardService.getIngestionTrends(days);
        res.json(data);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/dashboard/verification-trends?days=30
router.get('/verification-trends', async (req, res) => {
    try {
        const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;
        const data = await dashboardService.getVerificationTrends(days);
        res.json(data);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/dashboard/segment-breakdown
router.get('/segment-breakdown', async (_req, res) => {
    try {
        const data = await dashboardService.getSegmentBreakdown();
        res.json(data);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/dashboard/activity?limit=15
router.get('/activity', async (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 15;
        const data = await dashboardService.getRecentActivity(limit);
        res.json(data);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/dashboard/user-stats — per-user operation counts for Team Constellation
router.get('/user-stats', async (_req, res) => {
    try {
        const data = await dashboardService.getUserOperationStats();
        res.json(data);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/dashboard/engagement — delivery & engagement overview
router.get('/engagement', async (req, res) => {
    try {
        const days = req.query.days ? parseInt(req.query.days as string, 10) : 7;
        const { query: chQuery } = await import('../db/clickhouse.js');

        // Engagement metrics from engagement_events table
        const [metrics] = await chQuery<{
            total_events: string;
            bounces: string;
            hard_bounces: string;
            complaints: string;
            unsubscribes: string;
            opens: string;
            unique_opens: string;
            clicks: string;
            unique_clicks: string;
        }>(`
            SELECT
                count() as total_events,
                countIf(event_type = 'bounce') as bounces,
                countIf(event_type = 'bounce' AND bounce_type = 'hard') as hard_bounces,
                countIf(event_type = 'complaint') as complaints,
                countIf(event_type = 'unsubscribe') as unsubscribes,
                countIf(event_type = 'open') as opens,
                uniqIf(email, event_type = 'open') as unique_opens,
                countIf(event_type = 'click') as clicks,
                uniqIf(email, event_type = 'click') as unique_clicks
            FROM engagement_events
            WHERE received_at >= now() - INTERVAL ${days} DAY
        `);

        // Queue/push stats
        const [queueMetrics] = await chQuery<{
            total_pushed: string;
            total_sent: string;
            total_failed: string;
            active_jobs: string;
        }>(`
            SELECT
                sum(sent_count) as total_sent,
                sum(failed_count) as total_failed,
                countIf(status = 'sending') as active_jobs,
                count() as total_pushed
            FROM queue_jobs
            WHERE created_at >= now() - INTERVAL ${days} DAY
        `);

        // Suppressed leads count
        const [suppressed] = await chQuery<{ bounced: string; unsubscribed: string }>(`
            SELECT
                countIf(_bounced = 1) as bounced,
                countIf(_unsubscribed = 1) as unsubscribed
            FROM universal_person FINAL
            WHERE _bounced = 1 OR _unsubscribed = 1
        `);

        // Daily trend (last N days)
        const dailyTrend = await chQuery<{
            day: string;
            opens: string;
            clicks: string;
            bounces: string;
        }>(`
            SELECT
                toDate(received_at) as day,
                countIf(event_type = 'open') as opens,
                countIf(event_type = 'click') as clicks,
                countIf(event_type = 'bounce') as bounces
            FROM engagement_events
            WHERE received_at >= now() - INTERVAL ${days} DAY
            GROUP BY day
            ORDER BY day
        `);

        res.json({
            period_days: days,
            engagement: metrics || {},
            queue: queueMetrics || {},
            suppressed: suppressed || { bounced: '0', unsubscribed: '0' },
            daily_trend: dailyTrend,
        });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
