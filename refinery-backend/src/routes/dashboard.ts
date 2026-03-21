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

export default router;
