import { Router } from 'express';
import * as s3Service from '../services/s3sources.js';

const router = Router();

// GET /api/s3-sources — list all active sources
router.get('/', async (_req, res) => {
  try {
    const sources = await s3Service.listSources();
    // Mask secret keys in response
    const masked = sources.map(s => ({
      ...s,
      secret_key: s.secret_key ? '••••••••' + s.secret_key.slice(-4) : '',
      access_key: s.access_key ? s.access_key.slice(0, 8) + '••••' : '',
    }));
    res.json(masked);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/s3-sources/:id — get single source (masked)
router.get('/:id', async (req, res) => {
  try {
    const source = await s3Service.getSource(req.params.id);
    if (!source) return res.status(404).json({ error: 'Source not found' });
    res.json({
      ...source,
      secret_key: source.secret_key ? '••••••••' + source.secret_key.slice(-4) : '',
      access_key: source.access_key ? source.access_key.slice(0, 8) + '••••' : '',
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/s3-sources — create new source
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

// PUT /api/s3-sources/:id — update source
router.put('/:id', async (req, res) => {
  try {
    await s3Service.updateSource(req.params.id, req.body);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/s3-sources/:id — delete source
router.delete('/:id', async (req, res) => {
  try {
    await s3Service.deleteSource(req.params.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/s3-sources/:id/test — test saved source connection
router.post('/:id/test', async (req, res) => {
  try {
    const result = await s3Service.testSource(req.params.id);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/s3-sources/test-credentials — test before saving
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

// GET /api/s3-sources/:id/files — list files from source
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
