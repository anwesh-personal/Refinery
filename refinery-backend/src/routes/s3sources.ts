import { Router } from 'express';
import * as s3Service from '../services/s3sources.js';

const router = Router();

/* ── List all active sources (masked credentials) ── */
router.get('/', async (_req, res) => {
  try {
    const sources = await s3Service.listSources();
    res.json(sources.map(s3Service.maskCredentials));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── Test credentials before saving (MUST be before /:id routes) ── */
router.post('/test-credentials', async (req, res) => {
  try {
    const { label, bucket, region, accessKey, secretKey, prefix } = req.body;
    if (!bucket || !accessKey || !secretKey) {
      return res.status(400).json({ error: 'bucket, accessKey, and secretKey are required' });
    }
    const result = await s3Service.testCredentials({ label: label || '', bucket, region, accessKey, secretKey, prefix });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── Get single source (masked credentials) ── */
router.get('/:id', async (req, res) => {
  try {
    const source = await s3Service.getSource(req.params.id);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    res.json(s3Service.maskCredentials(source));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── Create new source ── */
router.post('/', async (req, res) => {
  try {
    const { label, bucket, region, accessKey, secretKey, prefix } = req.body;
    if (!label || !bucket || !accessKey || !secretKey) {
      return res.status(400).json({ error: 'label, bucket, accessKey, and secretKey are required' });
    }
    const id = await s3Service.createSource({ label, bucket, region, accessKey, secretKey, prefix });
    res.json({ id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── Update source ── */
router.put('/:id', async (req, res) => {
  try {
    await s3Service.updateSource(req.params.id, req.body);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── Delete source ── */
router.delete('/:id', async (req, res) => {
  try {
    await s3Service.deleteSource(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── Test a saved source connection ── */
router.post('/:id/test', async (req, res) => {
  try {
    const result = await s3Service.testSource(req.params.id);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/* ── List files from a specific source ── */
router.get('/:id/files', async (req, res) => {
  try {
    const prefix = req.query.prefix as string | undefined;
    const files = await s3Service.listSourceFiles(req.params.id, prefix);
    res.json(files);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
