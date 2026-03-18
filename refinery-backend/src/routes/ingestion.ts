import { Router } from 'express';
import * as ingestionService from '../services/ingestion.js';

const router = Router();

// GET /api/ingestion/stats
router.get('/stats', async (_req, res) => {
  try {
    const stats = await ingestionService.getIngestionStats();
    res.json(stats);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/jobs
router.get('/jobs', async (_req, res) => {
  try {
    const jobs = await ingestionService.getJobs();
    res.json(jobs);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/source-files?prefix=...
router.get('/source-files', async (req, res) => {
  try {
    const files = await ingestionService.listSourceFiles(req.query.prefix as string, req.query.sourceId as string);
    res.json(files);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/start  { sourceKey: "..." }
router.post('/start', async (req, res) => {
  try {
    const { sourceKey, sourceId } = req.body;
    if (!sourceKey) return res.status(400).json({ error: 'sourceKey is required' });
    const jobId = await ingestionService.startIngestionJob(sourceKey, sourceId);
    res.json({ jobId });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/start-bulk  { sourceKeys: ["..."], sourceId: "..." }
router.post('/start-bulk', async (req, res) => {
  try {
    const { sourceKeys, sourceId } = req.body;
    if (!sourceKeys || !Array.isArray(sourceKeys) || sourceKeys.length === 0) {
      return res.status(400).json({ error: 'sourceKeys array is required' });
    }
    const jobIds: string[] = [];
    for (const key of sourceKeys) {
      const jobId = await ingestionService.startIngestionJob(key, sourceId);
      jobIds.push(jobId);
    }
    res.json({ jobIds, count: jobIds.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/test-source
router.post('/test-source', async (_req, res) => {
  try {
    const result = await ingestionService.testSourceConnection();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/test-storage
router.post('/test-storage', async (_req, res) => {
  try {
    const result = await ingestionService.testStorageConnection();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ingestion/preview-file?sourceKey=...&sourceId=...&rows=20
// Streams first N rows from S3 without downloading the entire file
router.get('/preview-file', async (req, res) => {
  try {
    const sourceKey = req.query.sourceKey as string;
    const sourceId = req.query.sourceId as string | undefined;
    const maxRows = Math.min(Number(req.query.rows) || 20, 100);

    if (!sourceKey) return res.status(400).json({ error: 'sourceKey is required' });

    const preview = await ingestionService.previewFile(sourceKey, sourceId, maxRows);
    res.json(preview);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ingestion/start-bulk-daterange
// { sourceId: "...", prefix?: "...", startDate: "2024-01-01", endDate: "2024-12-31" }
// Filters files in the prefix by their lastModified date and ingests all matching
router.post('/start-bulk-daterange', async (req, res) => {
  try {
    const { sourceId, prefix, startDate, endDate } = req.body;
    if (!sourceId) return res.status(400).json({ error: 'sourceId is required' });
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // include the full end day

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    // List all files, filter by date range
    const listing = await ingestionService.listSourceFiles(prefix || '', sourceId);
    const matchingFiles = listing.files.filter(f => {
      if (!f.modified) return false;
      const fileDate = new Date(f.modified);
      return fileDate >= start && fileDate <= end;
    });

    if (matchingFiles.length === 0) {
      return res.json({ jobIds: [], count: 0, message: 'No files found in the specified date range.' });
    }

    const jobIds: string[] = [];
    for (const file of matchingFiles) {
      const jobId = await ingestionService.startIngestionJob(file.key, sourceId);
      jobIds.push(jobId);
    }

    res.json({ jobIds, count: jobIds.length, filesMatched: matchingFiles.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
