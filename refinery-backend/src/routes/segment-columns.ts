import { Router } from 'express';
import { query as chQuery } from '../db/clickhouse.js';

const router = Router();

// Column categories for the visual filter builder
const COLUMN_GROUPS: Record<string, { label: string; columns: string[] }> = {
  identity: {
    label: 'Identity',
    columns: ['first_name', 'last_name', 'gender', 'age_range', 'married', 'children'],
  },
  contact: {
    label: 'Contact',
    columns: ['business_email', 'personal_emails', 'mobile_phone', 'direct_number', 'personal_phone', 'linkedin_url'],
  },
  location: {
    label: 'Personal Location',
    columns: ['personal_city', 'personal_state', 'personal_zip', 'contact_country'],
  },
  professional: {
    label: 'Professional',
    columns: ['job_title', 'job_title_normalized', 'seniority_level', 'department', 'professional_city', 'professional_state'],
  },
  company: {
    label: 'Company',
    columns: ['company_name', 'company_domain', 'company_city', 'company_state', 'company_country', 'company_revenue', 'company_employee_count', 'primary_industry', 'company_sic', 'company_naics'],
  },
  wealth: {
    label: 'Wealth & Finance',
    columns: ['income_range', 'net_worth', 'homeowner'],
  },
  system: {
    label: 'System',
    columns: ['_verification_status', 'source_table', '_ingestion_job_id'],
  },
};

// GET /api/segment-columns  — full column metadata for the filter builder
router.get('/', async (_req, res) => {
  try {
    const rows = await chQuery<{ name: string; type: string }>(
      `SELECT name, type FROM system.columns
       WHERE table = 'universal_person' AND database = 'refinery'
       ORDER BY position`,
    );

    // Build a lookup
    const typeMap: Record<string, string> = {};
    for (const r of rows) typeMap[r.name] = r.type;

    // Build grouped output
    const groups = Object.entries(COLUMN_GROUPS).map(([key, group]) => ({
      key,
      label: group.label,
      columns: group.columns
        .filter(c => typeMap[c])
        .map(c => ({
          name: c,
          label: c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
          type: typeMap[c]?.includes('UInt') || typeMap[c]?.includes('Int') || typeMap[c]?.includes('Float')
            ? 'number'
            : typeMap[c]?.includes('DateTime') || typeMap[c]?.includes('Date')
              ? 'date'
              : 'string',
          nullable: typeMap[c]?.startsWith('Nullable'),
        })),
    }));

    res.json(groups);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/segment-columns/:column/values  — top distinct values for a column (for autocomplete)
router.get('/:column/values', async (req, res) => {
  try {
    const col = req.params.column.replace(/[^a-zA-Z0-9_]/g, '');
    if (!col) return res.status(400).json({ error: 'Invalid column' });

    const q = (req.query.q as string || '').replace(/'/g, "''");
    const whereClause = q ? `AND toString(${col}) ILIKE '%${q}%'` : '';

    const rows = await chQuery<{ val: string; cnt: string }>(
      `SELECT toString(${col}) as val, count() as cnt
       FROM refinery.universal_person
       WHERE ${col} IS NOT NULL AND toString(${col}) != '' ${whereClause}
       GROUP BY val ORDER BY cnt DESC LIMIT 20`,
    );
    res.json(rows.map(r => ({ value: r.val, count: Number(r.cnt) })));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
