import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { callAIJSON } from '../services/aiClient.js';

const router = Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════
// AI Data Enrichment — Feature #5
//
// Infers additional data from email addresses: company info,
// role/seniority, industry, tech stack hints, social presence.
// ═══════════════════════════════════════════════════════════

export interface EnrichmentConfig {
  enrichmentFields: {
    companyName: boolean;        // Infer company name from domain
    companySize: boolean;        // Estimate company size
    industry: boolean;           // Infer industry vertical
    roleSeniority: boolean;      // Infer role level from email prefix
    department: boolean;         // Infer department
    techStack: boolean;          // Infer tech stack from MX/domain
    buyerPersona: boolean;       // Create buyer persona type
    communicationPreference: boolean; // Preferred outreach style
  };
  enrichmentDepth: 'basic' | 'standard' | 'comprehensive';
  outputFormat: 'per_lead' | 'aggregated';
  industryContext: string;
  customFields: string;          // Free-form: "Also infer X, Y, Z"
  includeClassifications: string[];
  maxLeads: number;
}

export interface EnrichedLead {
  email: string;
  enrichments: {
    companyName?: string;
    companySize?: string;        // "Startup", "SMB", "Mid-Market", "Enterprise"
    industry?: string;
    role?: string;
    seniority?: string;          // "C-Suite", "VP", "Director", "Manager", "Individual"
    department?: string;
    techStack?: string[];
    buyerPersona?: string;
    communicationPreference?: string;
  };
  confidence: 'high' | 'medium' | 'low';
  enrichmentNotes: string;
}

export interface EnrichmentResult {
  leads: EnrichedLead[];
  aggregated: {
    companySizeDistribution: { label: string; count: number; percentage: number }[];
    industryDistribution: { label: string; count: number; percentage: number }[];
    seniorityDistribution: { label: string; count: number; percentage: number }[];
    departmentDistribution: { label: string; count: number; percentage: number }[];
  };
  insights: { title: string; description: string; impact: 'high' | 'medium' | 'low' }[];
  ai: { provider: string; model: string; latencyMs: number; wasFallback: boolean; tokensUsed?: number };
}

const DEFAULT_CONFIG: EnrichmentConfig = {
  enrichmentFields: { companyName: true, companySize: true, industry: true, roleSeniority: true, department: true, techStack: true, buyerPersona: true, communicationPreference: false },
  enrichmentDepth: 'standard',
  outputFormat: 'per_lead',
  industryContext: '',
  customFields: '',
  includeClassifications: ['safe', 'uncertain'],
  maxLeads: 100,
};

router.post('/', async (req, res) => {
  try {
    const { leads, config: userConfig } = req.body;
    if (!leads?.length) return res.status(400).json({ error: 'leads array required' });

    const config: EnrichmentConfig = { ...DEFAULT_CONFIG, ...userConfig, enrichmentFields: { ...DEFAULT_CONFIG.enrichmentFields, ...userConfig?.enrichmentFields } };

    let filtered = leads;
    if (config.includeClassifications.length > 0) filtered = filtered.filter((l: any) => config.includeClassifications.includes(l.classification));
    filtered = filtered.slice(0, config.maxLeads);
    if (!filtered.length) return res.status(400).json({ error: 'No leads match filters' });

    const { data, raw } = await callAIJSON<EnrichmentResult>(
      'data_enrichment',
      buildSystemPrompt(config),
      buildUserPrompt(filtered),
      { maxTokens: config.enrichmentDepth === 'comprehensive' ? 12288 : 8192, temperature: 0.3 }
    );

    if (!data || !raw.success) return res.status(502).json({ error: raw.error || 'Enrichment failed' });
    data.ai = { provider: raw.providerLabel, model: raw.model, latencyMs: raw.latencyMs, wasFallback: raw.wasFallback, tokensUsed: raw.tokensUsed };
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/config', (_req, res) => { res.json({ config: DEFAULT_CONFIG }); });

function buildSystemPrompt(config: EnrichmentConfig): string {
  const fields: string[] = [];
  if (config.enrichmentFields.companyName) fields.push('companyName: Infer company/organization name from the email domain');
  if (config.enrichmentFields.companySize) fields.push('companySize: Estimate as Startup (<50), SMB (50-200), Mid-Market (200-1000), Enterprise (1000+)');
  if (config.enrichmentFields.industry) fields.push('industry: Infer industry vertical from domain name, TLD, and any available context');
  if (config.enrichmentFields.roleSeniority) fields.push('role + seniority: Infer from email prefix (ceo@ = C-Suite, marketing@ = Marketing Dept, dev@ = Engineering, info@ = Generic)');
  if (config.enrichmentFields.department) fields.push('department: Engineering, Marketing, Sales, Operations, Finance, HR, Executive, Support, Generic');
  if (config.enrichmentFields.techStack) fields.push('techStack: Infer from MX provider (Google Workspace → G Suite stack, Microsoft → M365 stack, self-hosted → technical)');
  if (config.enrichmentFields.buyerPersona) fields.push('buyerPersona: Create a buyer persona type (Technical Decision Maker, Business Leader, Practitioner, Evaluator, Gatekeeper)');
  if (config.enrichmentFields.communicationPreference) fields.push('communicationPreference: Inferred preferred outreach style (formal/consultative/casual/data-driven)');

  const depth = config.enrichmentDepth === 'comprehensive' ? 'Be extremely thorough. Make educated inferences even with limited data. Explain reasoning.' :
    config.enrichmentDepth === 'basic' ? 'Quick enrichment. Only high-confidence inferences.' : 'Balanced depth. Make reasonable inferences with confidence notes.';

  return `You are an expert B2B data enrichment specialist. Your task is to enrich email lead data by inferring additional attributes from email addresses, domains, and verification metadata.

${depth}

ENRICHMENT FIELDS:
${fields.map((f, i) => `${i + 1}. ${f}`).join('\n')}

${config.industryContext ? `INDUSTRY CONTEXT: ${config.industryContext}` : ''}
${config.customFields ? `CUSTOM ENRICHMENTS: ${config.customFields}` : ''}

ENRICHMENT METHODOLOGY:
- Domain analysis: company-name.com → Company Name, .io → likely tech/startup, .edu → education
- Prefix analysis: ceo/cto/cfo → C-Suite, marketing/sales → respective dept, info/admin/support → generic
- MX analysis: Google Workspace users tend to be modern/cloud-first, Microsoft = enterprise, self-hosted = technical
- TLD analysis: .com = global, .co.uk = UK business, .de = German, .in = Indian market
- Free providers: Gmail/Yahoo = personal or micro-business, no company enrichment possible

For each lead assign confidence: high (strong signals), medium (reasonable inference), low (educated guess).

Respond in JSON with:
- leads: array of enriched leads
- aggregated: distribution breakdowns (companySizeDistribution, industryDistribution, seniorityDistribution, departmentDistribution)
- insights: 3-5 notable findings about the dataset`;
}

function buildUserPrompt(leads: any[]): string {
  const simplified = leads.map(l => ({
    email: l.email, classification: l.classification,
    role: l.checks?.roleBased?.detected ? l.checks.roleBased.prefix : null,
    freeProvider: l.checks?.freeProvider?.detected ? l.checks.freeProvider.category : null,
    spf: l.checks?.domainAuth?.spf ?? null, dmarc: l.checks?.domainAuth?.dmarc ?? null,
    domainAgeDays: l.checks?.domainAge?.ageDays ?? null,
    mx: l.checks?.mxValid?.valid ?? null,
  }));
  return `Enrich these ${simplified.length} email leads:\n\n${JSON.stringify(simplified, null, 2)}`;
}

export default router;
