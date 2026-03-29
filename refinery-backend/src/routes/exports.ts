import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { exportToS3, listExports } from '../services/s3-export.js';
import { syncSegmentToMailwizz } from '../services/mailwizz-sync.js';
import { pushToMTA } from '../services/audience-sync.js';

// ═══════════════════════════════════════════════════════════
// Export Routes — Push verified leads to S3 or MailWizz
// ═══════════════════════════════════════════════════════════

const router = Router();
router.use(requireAuth);

/**
 * POST /api/export/s3
 * Export leads to an S3 bucket as CSV or JSON.
 *
 * Body: {
 *   sourceId: string,       // S3 source ID
 *   segmentId?: string,     // segment-based export
 *   table?: string,         // table-based export
 *   sourceFile?: string,    // filter by source_file
 *   columns?: string[],     // specific columns
 *   format?: 'csv' | 'json',
 *   prefix?: string,        // S3 key prefix
 *   filename?: string,      // custom filename
 *   verifiedOnly?: boolean, // default true
 * }
 */
router.post('/s3', async (req, res) => {
  try {
    const { sourceId, segmentId, table, sourceFile, columns, format, prefix, filename, verifiedOnly } = req.body;

    if (!sourceId) {
      return res.status(400).json({ error: 'sourceId is required. Configure an S3 source first.' });
    }
    if (!segmentId && !table) {
      return res.status(400).json({ error: 'Either segmentId or table must be provided.' });
    }

    const result = await exportToS3({
      sourceId,
      segmentId,
      table,
      sourceFile,
      columns,
      format: format || 'csv',
      prefix,
      filename,
      verifiedOnly: verifiedOnly !== false,
    });

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /api/export/s3/:sourceId/list
 * List recent exports from a source's exports/ prefix.
 */
router.get('/s3/:sourceId/list', async (req, res) => {
  try {
    const files = await listExports(req.params.sourceId);
    res.json({ files });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/export/mailwizz
 * Push a segment's verified leads to MailWizz.
 *
 * Body: { segmentId: string }
 */
router.post('/mailwizz', async (req, res) => {
  try {
    const { segmentId } = req.body;
    if (!segmentId) {
      return res.status(400).json({ error: 'segmentId is required' });
    }

    const result = await syncSegmentToMailwizz(segmentId);
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/export/mta
 * Push audience to configured MTA with column mappings.
 *
 * Body: {
 *   targetListId: string,
 *   listName: string,
 *   segmentId: string,
 *   columnMappings: Array<{ clickhouse_column: string, mta_field: string }>,
 *   excludeRoleBased?: boolean,
 *   excludeFreeProviders?: boolean,
 *   minVerificationScore?: number,
 *   dedupDays?: number,
 * }
 */
router.post('/mta', async (req, res) => {
  try {
    const { targetListId, listName, segmentId, columnMappings } = req.body;

    if (!targetListId || !listName || !segmentId || !columnMappings?.length) {
      return res.status(400).json({
        error: 'Required: targetListId, listName, segmentId, columnMappings',
      });
    }

    const result = await pushToMTA({
      targetListId,
      listName,
      segmentId,
      columnMappings,
      excludeRoleBased: req.body.excludeRoleBased,
      excludeFreeProviders: req.body.excludeFreeProviders,
      minVerificationScore: req.body.minVerificationScore,
      dedupDays: req.body.dedupDays,
    });

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
