import { Router } from 'express';
import { requireScope } from '../../middleware/apiKeyAuth.js';
import { query, command, insertRows } from '../../db/clickhouse.js';
import { genId } from '../../utils/helpers.js';

// ═══════════════════════════════════════════════════════════════
// v1 Contact Endpoints — API-key authenticated (auth applied in index.ts)
// GET    /api/v1/contacts            — list/search contacts (paginated)
// GET    /api/v1/contacts/:id        — get single contact
// POST   /api/v1/contacts            — create/upsert contacts (batch)
// PATCH  /api/v1/contacts/:id        — update a contact
// GET    /api/v1/contacts/count      — total count with optional filters
// POST   /api/v1/contacts/search     — advanced search (filter object)
// ═══════════════════════════════════════════════════════════════

const router = Router();

const SAFE_COLUMNS = [
  'up_id', 'first_name', 'last_name', 'gender', 'age_range',
  'business_email', 'personal_emails', 'mobile_phone', 'direct_number',
  'linkedin_url', 'job_title', 'job_title_normalized', 'seniority_level',
  'department', 'company_name', 'company_domain', 'company_revenue',
  'company_employee_count', 'primary_industry', 'personal_state',
  'personal_city', 'personal_zip', 'contact_country',
  'business_email_validation_status', 'personal_emails_validation_status',
  '_verification_status', '_verified_at', '_segment_ids', '_ingested_at',
];

function sanitize(val: string): string {
  return val.replace(/'/g, "\\'").replace(/;/g, '');
}

function clampPage(val: unknown, fallback: number, max: number): number {
  const n = Number(val) || fallback;
  return Math.min(Math.max(1, n), max);
}

function clampPageSize(val: unknown, fallback: number, max: number): number {
  const n = Number(val) || fallback;
  return Math.min(Math.max(1, n), max);
}

// GET /api/v1/contacts/count
router.get('/count', requireScope('contacts:read'), async (req, res) => {
  try {
    const { state, industry, verification_status, company_domain } = req.query;
    const conditions: string[] = [];

    if (state) conditions.push(`personal_state = '${sanitize(String(state))}'`);
    if (industry) conditions.push(`primary_industry = '${sanitize(String(industry))}'`);
    if (verification_status) conditions.push(`_verification_status = '${sanitize(String(verification_status))}'`);
    if (company_domain) conditions.push(`company_domain = '${sanitize(String(company_domain))}'`);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [row] = await query<{ cnt: string }>(`SELECT count() as cnt FROM universal_person ${where}`);
    res.json({ data: { count: Number(row?.cnt || 0) } });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/contacts
router.get('/', requireScope('contacts:read'), async (req, res) => {
  try {
    const page = clampPage(req.query.page, 1, 10000);
    const perPage = clampPageSize(req.query.per_page, 50, 500);
    const offset = (page - 1) * perPage;

    const { state, industry, verification_status, company_domain, sort_by, sort_dir } = req.query;
    const conditions: string[] = [];

    if (state) conditions.push(`personal_state = '${sanitize(String(state))}'`);
    if (industry) conditions.push(`primary_industry = '${sanitize(String(industry))}'`);
    if (verification_status) conditions.push(`_verification_status = '${sanitize(String(verification_status))}'`);
    if (company_domain) conditions.push(`company_domain = '${sanitize(String(company_domain))}'`);

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sortCol = SAFE_COLUMNS.includes(String(sort_by)) ? String(sort_by) : '_ingested_at';
    const sortDirection = String(sort_dir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const [countRow] = await query<{ cnt: string }>(
      `SELECT count() as cnt FROM universal_person ${where}`,
    );
    const total = Number(countRow?.cnt || 0);

    const cols = SAFE_COLUMNS.join(', ');
    const rows = await query(
      `SELECT ${cols} FROM universal_person ${where} ORDER BY ${sortCol} ${sortDirection} LIMIT ${perPage} OFFSET ${offset}`,
    );

    res.json({
      data: rows,
      meta: { total, page, per_page: perPage, total_pages: Math.ceil(total / perPage) },
    });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// GET /api/v1/contacts/:id
router.get('/:id', requireScope('contacts:read'), async (req, res) => {
  try {
    const id = sanitize(String(req.params.id));
    const rows = await query(
      `SELECT * FROM universal_person WHERE up_id = '${id}' LIMIT 1`,
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    }
    res.json({ data: rows[0] });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// POST /api/v1/contacts — batch upsert
router.post('/', requireScope('contacts:write'), async (req, res) => {
  try {
    const { contacts } = req.body;

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'contacts[] array is required' },
      });
    }

    if (contacts.length > 10000) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'Max 10,000 contacts per batch' },
      });
    }

    const rows = contacts.map((c: Record<string, unknown>) => ({
      up_id: c.up_id || genId(),
      first_name: c.first_name || null,
      last_name: c.last_name || null,
      business_email: c.business_email || null,
      personal_emails: c.personal_emails || null,
      mobile_phone: c.mobile_phone || null,
      direct_number: c.direct_number || null,
      linkedin_url: c.linkedin_url || null,
      job_title: c.job_title || null,
      job_title_normalized: c.job_title_normalized || null,
      seniority_level: c.seniority_level || null,
      department: c.department || null,
      company_name: c.company_name || null,
      company_domain: c.company_domain || null,
      company_revenue: c.company_revenue || null,
      company_employee_count: c.company_employee_count || null,
      primary_industry: c.primary_industry || null,
      personal_state: c.personal_state || null,
      personal_city: c.personal_city || null,
      personal_zip: c.personal_zip || null,
      contact_country: c.contact_country || null,
      gender: c.gender || null,
      age_range: c.age_range || null,
      _ingestion_job_id: c._ingestion_job_id || `api_v1_${Date.now()}`,
    }));

    await insertRows('universal_person', rows);

    res.status(201).json({
      data: { inserted: rows.length, ids: rows.map((r: any) => r.up_id) },
    });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// PATCH /api/v1/contacts/:id
router.patch('/:id', requireScope('contacts:write'), async (req, res) => {
  try {
    const id = sanitize(String(req.params.id));
    const updates = req.body;

    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'At least one field to update is required' },
      });
    }

    const allowedFields = SAFE_COLUMNS.filter(c => !c.startsWith('_') && c !== 'up_id');
    const setClauses: string[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (!allowedFields.includes(key)) continue;
      setClauses.push(`${key} = '${sanitize(String(value ?? ''))}'`);
    }

    if (setClauses.length === 0) {
      return res.status(400).json({
        error: { code: 'VALIDATION', message: 'No valid fields to update' },
      });
    }

    const existing = await query(`SELECT up_id FROM universal_person WHERE up_id = '${id}' LIMIT 1`);
    if (existing.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
    }

    const setStr = setClauses.join(', ');
    await command(`ALTER TABLE universal_person UPDATE ${setStr} WHERE up_id = '${id}'`);

    res.json({ data: { updated: true, id } });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

// POST /api/v1/contacts/search — advanced search with filter object
router.post('/search', requireScope('contacts:read'), async (req, res) => {
  try {
    const { filters, page: rawPage, per_page: rawPerPage, sort_by, sort_dir } = req.body;

    const page = clampPage(rawPage, 1, 10000);
    const perPage = clampPageSize(rawPerPage, 50, 500);
    const offset = (page - 1) * perPage;
    const conditions: string[] = [];

    if (filters && typeof filters === 'object') {
      for (const [key, val] of Object.entries(filters)) {
        if (!SAFE_COLUMNS.includes(key)) continue;

        if (typeof val === 'string') {
          conditions.push(`${key} = '${sanitize(val)}'`);
        } else if (Array.isArray(val)) {
          const vals = val.map(v => `'${sanitize(String(v))}'`).join(', ');
          conditions.push(`${key} IN (${vals})`);
        } else if (typeof val === 'object' && val !== null) {
          const op = val as Record<string, unknown>;
          if (op.like) conditions.push(`${key} ILIKE '%${sanitize(String(op.like))}%'`);
          if (op.gt) conditions.push(`${key} > '${sanitize(String(op.gt))}'`);
          if (op.lt) conditions.push(`${key} < '${sanitize(String(op.lt))}'`);
          if (op.not) conditions.push(`${key} != '${sanitize(String(op.not))}'`);
          if (op.is_null === true) conditions.push(`${key} IS NULL`);
          if (op.is_null === false) conditions.push(`${key} IS NOT NULL`);
        }
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortCol = SAFE_COLUMNS.includes(String(sort_by)) ? String(sort_by) : '_ingested_at';
    const sortDirection = String(sort_dir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const [countRow] = await query<{ cnt: string }>(
      `SELECT count() as cnt FROM universal_person ${where}`,
    );
    const total = Number(countRow?.cnt || 0);

    const cols = SAFE_COLUMNS.join(', ');
    const rows = await query(
      `SELECT ${cols} FROM universal_person ${where} ORDER BY ${sortCol} ${sortDirection} LIMIT ${perPage} OFFSET ${offset}`,
    );

    res.json({
      data: rows,
      meta: { total, page, per_page: perPage, total_pages: Math.ceil(total / perPage) },
    });
  } catch (e: any) {
    res.status(500).json({ error: { code: 'INTERNAL', message: e.message } });
  }
});

export default router;
