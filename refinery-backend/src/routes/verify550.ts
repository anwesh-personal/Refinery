import { Router } from 'express';
import multer from 'multer';
import * as v550 from '../services/verify550.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB max

// All routes require authentication
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════════
// Verify550 Proxy Routes
// All API calls go through backend so API secret stays server-side
// ═══════════════════════════════════════════════════════════════

// GET /api/v550/credits — Check credit balance
router.get('/credits', async (req, res) => {
  try {
    const apiKey = await v550.resolveApiKey((req as any).userId);
    const credits = await v550.getCredits(apiKey);
    res.json({ credits });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/v550/verify?email=xxx — Verify single email
router.get('/verify', async (req, res) => {
  try {
    const email = String(req.query.email || '').trim();
    if (!email) return res.status(400).json({ error: 'email parameter required' });

    const apiKey = await v550.resolveApiKey((req as any).userId);
    const status = await v550.verifySingle(apiKey, email);
    res.json({ email, status });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/v550/upload — Upload CSV for bulk verification
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const apiKey = await v550.resolveApiKey((req as any).userId);
    const result = await v550.uploadBulk(
      apiKey,
      req.file.originalname || 'upload.csv',
      req.file.buffer,
      req.file.mimetype
    );
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/v550/job/:id — Get job details/status
router.get('/job/:id', async (req, res) => {
  try {
    const apiKey = await v550.resolveApiKey((req as any).userId);
    const result = await v550.getJob(apiKey, req.params.id);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/v550/jobs/completed — List all completed jobs
router.get('/jobs/completed', async (req, res) => {
  try {
    const apiKey = await v550.resolveApiKey((req as any).userId);
    const result = await v550.getCompletedJobs(apiKey);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/v550/jobs/running — List all running jobs
router.get('/jobs/running', async (req, res) => {
  try {
    const apiKey = await v550.resolveApiKey((req as any).userId);
    const result = await v550.getRunningJobs(apiKey);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/v550/export/:id — Download job results as .zip
// Query params: format=xlsx|csv, categories=ok,email_disabled,...
router.get('/export/:id', async (req, res) => {
  try {
    const apiKey = await v550.resolveApiKey((req as any).userId);
    const format = req.query.format as 'xlsx' | 'csv' | undefined;
    const categories = req.query.categories ? String(req.query.categories).split(',') : undefined;

    const { buffer, contentType, filename } = await v550.exportJob(
      apiKey, req.params.id, format, categories
    );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
