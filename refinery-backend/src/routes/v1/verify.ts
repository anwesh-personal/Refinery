import { Router } from 'express';
import { requireScope } from '../../middleware/apiKeyAuth.js';
import { query } from '../../db/clickhouse.js';

// ═══════════════════════════════════════════════════════════════
// v1 Verify Endpoints — API-key authenticated (auth applied in index.ts)
// GET    /api/v1/verify/status/:email   — check verification status of an email
// POST   /api/v1/verify/bulk-status     — check status of multiple emails
// GET    /api/v1/verify/batches         — list verification batches
// GET    /api/v1/verify/batches/:id     — get batch details
// GET    /api/v1/verify/stats           — overall verification stats
// ═══════════════════════════════════════════════════════════════

const router = Router();

function sanitize(val: string): string {
  return val.replace(/'/g, "\\'").replace(/;/g, '');
}

// GET /api/v1/verify/stats
router.get('/stats', requireScope('verify:read'), async (_req, res) => {
  try {
    const [totals] = await query<{
      total: string;
      verified: string;
      bounced: string;
      pending: string;
    }>(`
      SELECT
        count() as total,
        countIf(_verification_status = 'safe' OR _verification_status = 'valid') as verified,
        countIf(_verification_status = 'bounced' OR _verification_status = 'rejected') as bounced,
        countIf(_verification_status IS NULL OR _verification_status = '') as pending
      FROM universal_person
      WHERE business_email IS NOT NULL AND business_email != ''
    `);

    res.json({
      data: {
        total_with_email: Number(totals?.total || 0),
        verified: Number(totals?.verified || 0),
        bounced: Number(totals?.bounced || 0),
        pending: Number(totals?.pending || 0),
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/verify/status/:email
router.get('/status/:email', requireScope('verify:read'), async (req, res) => {
  try {
    const email = sanitize(String(req.params.email).toLowerCase().trim());

    const rows = await query<{
      up_id: string;
      business_email: string;
      business_email_validation_status: string;
      _verification_status: string;
      _verified_at: string;
    }>(`
      SELECT up_id, business_email, business_email_validation_status,
             _verification_status, _verified_at
      FROM universal_person
      WHERE lower(business_email) = '${email}'
         OR has(splitByChar(',', lower(ifNull(personal_emails, ''))), '${email}')
      LIMIT 10
    `);

    if (rows.length === 0) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Email not found in database' },
      });
    }

    res.json({ data: rows });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// POST /api/v1/verify/bulk-status — check multiple emails at once
router.post('/bulk-status', requireScope('verify:read'), async (req, res) => {
  try {
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'emails[] array is required' },
      });
    }

    if (emails.length > 1000) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'Max 1,000 emails per request' },
      });
    }

    const emailList = emails.map((e: string) => `'${sanitize(e.toLowerCase().trim())}'`).join(', ');

    const rows = await query<{
      business_email: string;
      business_email_validation_status: string;
      _verification_status: string;
      _verified_at: string;
    }>(`
      SELECT business_email, business_email_validation_status,
             _verification_status, _verified_at
      FROM universal_person
      WHERE lower(business_email) IN (${emailList})
    `);

    const statusMap: Record<string, unknown> = {};
    for (const row of rows) {
      const key = (row.business_email || '').toLowerCase();
      statusMap[key] = {
        validation_status: row.business_email_validation_status,
        verification_status: row._verification_status,
        verified_at: row._verified_at,
      };
    }

    const results = emails.map((email: string) => {
      const key = email.toLowerCase().trim();
      return {
        email: key,
        found: !!statusMap[key],
        ...(statusMap[key] as object || { validation_status: null, verification_status: null, verified_at: null }),
      };
    });

    res.json({
      data: results,
      meta: { requested: emails.length, found: Object.keys(statusMap).length },
    });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/verify/batches
router.get('/batches', requireScope('verify:read'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = await query(
      `SELECT * FROM verification_batches ORDER BY started_at DESC LIMIT ${limit}`,
    );
    res.json({ data: rows });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/verify/batches/:id
router.get('/batches/:id', requireScope('verify:read'), async (req, res) => {
  try {
    const id = sanitize(String(req.params.id));
    const rows = await query(`SELECT * FROM verification_batches WHERE id = '${id}' LIMIT 1`);
    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Batch not found' } });
    }
    res.json({ data: rows[0] });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

export default router;
