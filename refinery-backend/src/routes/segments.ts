import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import fs from 'fs';
import * as segService from '../services/segments.js';
import { validateSegmentFilter } from '../services/segments.js';
import { getRequestUser } from '../types/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { syncSegmentToMailwizz } from '../services/mailwizz-sync.js';

const router = Router();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max
router.use(requireAuth);

// GET /api/segments
router.get('/', async (_req, res) => {
  try { res.json(await segService.listSegments()); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/segments/validate
router.post('/validate', async (req, res) => {
  try {
    const { filterQuery } = req.body;
    if (!filterQuery) return res.status(400).json({ error: 'filterQuery is required' });
    res.json(await validateSegmentFilter(filterQuery));
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/segments/preview
router.post('/preview', async (req, res) => {
  try {
    const { filterQuery } = req.body;
    if (!filterQuery) return res.status(400).json({ error: 'filterQuery is required' });
    res.json(await segService.previewSegment(filterQuery));
  } catch (e: any) { res.status(500).json({ error: e.message, suggestion: (e as any).suggestion }); }
});

// POST /api/segments/count  — live count for filter builder
router.post('/count', async (req, res) => {
  try {
    const { filterQuery } = req.body;
    if (!filterQuery) return res.status(400).json({ error: 'filterQuery is required' });
    const count = await segService.liveCount(filterQuery);
    res.json({ count });
  } catch (e: any) { res.status(400).json({ error: e.message }); }
});

// POST /api/segments  { name, niche?, clientName?, filterQuery }
router.post('/', async (req, res) => {
  try {
    const { name, niche, clientName, filterQuery } = req.body;
    if (!name || !filterQuery) return res.status(400).json({ error: 'name and filterQuery are required' });
    const user = getRequestUser(req);
    const id = await segService.createSegment({ name, niche, clientName, filterQuery }, user.id, user.name);
    res.json({ id });
  } catch (e: any) { res.status(500).json({ error: e.message, suggestion: (e as any).suggestion }); }
});

// POST /api/segments/upload — Create segment from uploaded CSV of emails
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const user = getRequestUser(req);
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Segment name is required' });

    const matchColumn = (req.body.matchColumn || 'any') as 'business_email' | 'personal_emails' | 'any';
    const emailColumnHeader = String(req.body.emailColumn || '').trim().toLowerCase();

    // Read and parse CSV
    const raw = fs.readFileSync(req.file.path, 'utf-8');
    fs.unlinkSync(req.file.path); // cleanup

    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return res.status(400).json({ error: 'CSV file is empty' });

    // Detect if first line is a header
    const firstLine = lines[0];
    const delim = firstLine.includes('\t') ? '\t' : ',';
    const headers = firstLine.split(delim).map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());

    // Find the email column index
    let emailIdx = 0; // default: first column
    if (emailColumnHeader) {
      const idx = headers.findIndex(h => h === emailColumnHeader);
      if (idx >= 0) emailIdx = idx;
    } else {
      // Auto-detect: find column with "email" in header
      const idx = headers.findIndex(h => h.includes('email') || h === 'e-mail' || h === 'emailaddress');
      if (idx >= 0) emailIdx = idx;
    }

    // Check if first line is a header (not an email)
    const isHeader = !headers[emailIdx].includes('@');
    const dataLines = isHeader ? lines.slice(1) : lines;

    // Extract emails
    const emails: string[] = [];
    for (const line of dataLines) {
      const cols = line.split(delim);
      const email = (cols[emailIdx] || '').trim().replace(/^["']|["']$/g, '');
      if (email && email.includes('@')) {
        emails.push(email);
      }
    }

    if (emails.length === 0) return res.status(400).json({ error: 'No valid emails found in the uploaded file' });

    const result = await segService.createSegmentFromUpload(name, emails, matchColumn, user.id, user.name);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/segments/:id
router.get('/:id', async (req, res) => {
  try {
    const seg = await segService.getSegment(req.params.id);
    if (!seg) return res.status(404).json({ error: 'Segment not found' });
    res.json(seg);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUT /api/segments/:id
router.put('/:id', async (req, res) => {
  try {
    const { name, niche, clientName, filterQuery } = req.body;
    await segService.updateSegment(req.params.id, { name, niche, clientName, filterQuery });
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUT /api/segments/:id/schedule  { scheduleCron: '0 6 * * *' | null }
router.put('/:id/schedule', async (req, res) => {
  try {
    const { scheduleCron } = req.body;
    await segService.updateSegment(req.params.id, { scheduleCron: scheduleCron ?? null });
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/segments/:id/execute
router.post('/:id/execute', async (req, res) => {
  try {
    const count = await segService.executeSegment(req.params.id);
    res.json({ count });
  } catch (e: any) { res.status(500).json({ error: e.message, suggestion: (e as any).suggestion }); }
});

// POST /api/segments/:id/sync-mailwizz
router.post('/:id/sync-mailwizz', async (req, res) => {
  try {
    const result = await syncSegmentToMailwizz(req.params.id);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/segments/:id/sync-status
router.get('/:id/sync-status', async (req, res) => {
  try {
    const seg = await segService.getSegment(req.params.id);
    if (!seg) return res.status(404).json({ error: 'Not found' });
    res.json({
      sync_status: seg.sync_status,
      sync_count: seg.sync_count,
      last_synced_at: seg.last_synced_at,
      mailwizz_list_id: seg.mailwizz_list_id,
    });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/segments/:id/export
router.get('/:id/export', async (req, res) => {
  try {
    const rows = await segService.exportSegmentLeads(req.params.id);
    const user = getRequestUser(req);
    console.log(`[Export] Segment ${req.params.id} by ${user.name} — ${rows.length} rows`);
    res.json({ rows, count: rows.length });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/segments/:id
router.delete('/:id', async (req, res) => {
  try {
    await segService.deleteSegment(req.params.id);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
