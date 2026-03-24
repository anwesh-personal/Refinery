import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import { z } from 'zod';
import * as v550 from '../services/verify550.js';
import { requireAuth } from '../middleware/auth.js';
import { getRequestUser } from '../types/auth.js';

const router = Router();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB max directly to disk to prevent OOM

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
    const rawEmail = String(req.query.email || '').trim();
    if (!rawEmail) return res.status(400).json({ error: 'email parameter required' });

    // Enforce valid payload structure before proxying
    const parsed = z.string().email('Invalid email syntax').safeParse(rawEmail);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const email = parsed.data;
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
      req.file.path // Streams directly off disk instead of blowing up server memory
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
    const user = getRequestUser(req);
    console.log(`[Export] V550 job ${req.params.id} exported by ${user.name} (${user.id}) — format: ${format || 'default'}`);
    res.send(buffer);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/v550/import/:id — Import V550 job results → ClickHouse
router.post('/import/:id', async (req, res) => {
  try {
    const user = getRequestUser(req);
    const apiKey = await v550.resolveApiKey(user.id);
    const jobId = req.params.id;

    console.log(`[V550 Import] User ${user.name} (${user.id}) importing job ${jobId}`);
    const result = await v550.importJobToClickHouse(apiKey, jobId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/v550/categories — Get category → status mapping (for UI)
router.get('/categories', (_req, res) => {
  res.json(v550.CATEGORY_STATUS_MAP);
});

export default router;
