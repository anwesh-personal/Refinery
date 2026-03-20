import { Router } from 'express';
import * as logService from '../services/logs.js';

const router = Router();

// GET /api/logs?lines=200&level=error&search=clickhouse
router.get('/', async (req, res) => {
    try {
        const lines = req.query.lines ? parseInt(req.query.lines as string, 10) : 200;
        const level = (req.query.level as string) || undefined;
        const search = (req.query.search as string) || undefined;
        const entries = await logService.getLogs({ lines, level, search });
        res.json(entries);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/logs/files
router.get('/files', async (_req, res) => {
    try {
        const files = await logService.getLogFiles();
        res.json(files);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/logs/clear  { fileName }
router.post('/clear', async (req, res) => {
    try {
        const { fileName } = req.body;
        if (!fileName) return res.status(400).json({ error: 'fileName is required' });
        await logService.clearLogFile(fileName);
        res.json({ ok: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

export default router;
