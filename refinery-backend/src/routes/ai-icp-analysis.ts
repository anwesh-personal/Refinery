import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { callAIJSON } from '../services/aiClient.js';

const router = Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════
// AI-Powered ICP Analysis — Feature #2
//
// Analyzes verified lead data to build an Ideal Customer Profile.
// Identifies patterns, clusters, domain/role distribution,
// and returns actionable ICP segments with match scoring.
// ═══════════════════════════════════════════════════════════

// ─── Types ───

export interface ICPConfig {
  // Analysis depth
  analysisDepth: 'quick' | 'standard' | 'deep';
  // Focus areas (user selects which to analyze)
  focusAreas: {
    domainPatterns: boolean;      // Analyze domain types/industries
    roleAnalysis: boolean;        // Analyze email prefixes for role patterns
    providerDistribution: boolean;// Business vs free provider breakdown
    authQuality: boolean;         // SPF/DMARC/domain infrastructure
    geographicHints: boolean;     // TLD-based region inference
    riskCorrelation: boolean;     // Correlate risk factors with patterns
  };
  // Business context (helps AI understand the use case)
  industry: string;               // e.g. "SaaS", "E-commerce", "Healthcare"
  targetAudience: string;         // e.g. "CTOs at mid-market SaaS companies"
  customContext: string;           // Free-form additional context
  // Filtering
  includeClassifications: string[]; // Which verification classes to include
  minRiskScore: number;            // Exclude leads above this risk score
  maxLeads: number;                // Cap for token control
}

export interface ICPResult {
  profile: {
    summary: string;                // 2-3 sentence ICP summary
    idealDomainTypes: string[];     // e.g. ["SaaS companies", ".io domains", "tech sector"]
    idealRoles: string[];           // e.g. ["decision-makers", "C-suite", "engineering leads"]
    idealProviders: string[];       // e.g. ["Google Workspace", "Microsoft 365"]
    redFlags: string[];             // Patterns to avoid
    strengthIndicators: string[];   // What makes a lead high-quality in this dataset
  };
  segments: ICPSegment[];
  insights: ICPInsight[];
  distribution: {
    domainTypes: { label: string; count: number; percentage: number }[];
    roleTypes: { label: string; count: number; percentage: number }[];
    providerTypes: { label: string; count: number; percentage: number }[];
    authQuality: { label: string; count: number; percentage: number }[];
  };
  ai: { provider: string; model: string; latencyMs: number; wasFallback: boolean; tokensUsed?: number };
}

export interface ICPSegment {
  name: string;                    // e.g. "Tech Decision Makers"
  description: string;
  matchPercentage: number;         // How well this segment matches ICP
  leadCount: number;
  sampleEmails: string[];          // 3-5 examples
  characteristics: string[];       // Key traits of this segment
  recommendedAction: string;       // What to do with this segment
}

export interface ICPInsight {
  category: 'opportunity' | 'warning' | 'pattern' | 'recommendation';
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
}

const DEFAULT_CONFIG: ICPConfig = {
  analysisDepth: 'standard',
  focusAreas: {
    domainPatterns: true,
    roleAnalysis: true,
    providerDistribution: true,
    authQuality: true,
    geographicHints: true,
    riskCorrelation: true,
  },
  industry: '',
  targetAudience: '',
  customContext: '',
  includeClassifications: ['safe', 'uncertain'],
  minRiskScore: 0,
  maxLeads: 200,
};

// ─── POST /api/ai/icp-analysis — Analyze leads for ICP ───

router.post('/', async (req, res) => {
  try {
    const { leads, config: userConfig } = req.body;

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'leads array is required' });
    }

    const config: ICPConfig = {
      ...DEFAULT_CONFIG,
      ...userConfig,
      focusAreas: { ...DEFAULT_CONFIG.focusAreas, ...userConfig?.focusAreas },
    };

    // Filter leads
    let filtered = leads;
    if (config.includeClassifications.length > 0) {
      filtered = filtered.filter((l: any) => config.includeClassifications.includes(l.classification));
    }
    if (config.minRiskScore > 0) {
      filtered = filtered.filter((l: any) => (l.riskScore || 0) <= config.minRiskScore);
    }
    filtered = filtered.slice(0, config.maxLeads);

    if (filtered.length === 0) {
      return res.status(400).json({ error: 'No leads match the filter criteria' });
    }

    const systemPrompt = buildSystemPrompt(config);
    const userPrompt = buildUserPrompt(filtered, config);

    const tokenBudget = config.analysisDepth === 'deep' ? 12288 : config.analysisDepth === 'standard' ? 8192 : 4096;

    const { data, raw } = await callAIJSON<ICPResult>(
      'icp_analysis',
      systemPrompt,
      userPrompt,
      { maxTokens: tokenBudget, temperature: 0.3 }
    );

    if (!data || !raw.success) {
      return res.status(502).json({
        error: raw.error || 'ICP analysis failed',
        ai: { provider: raw.providerLabel, model: raw.model, latencyMs: raw.latencyMs, wasFallback: raw.wasFallback },
      });
    }

    // Attach AI metadata
    data.ai = {
      provider: raw.providerLabel,
      model: raw.model,
      latencyMs: raw.latencyMs,
      wasFallback: raw.wasFallback,
      tokensUsed: raw.tokensUsed,
    };

    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/ai/icp-analysis/config — Default config ───

router.get('/config', (_req, res) => {
  res.json({ config: DEFAULT_CONFIG });
});

// ─── Prompt Construction ───

function buildSystemPrompt(config: ICPConfig): string {
  const areas: string[] = [];
  if (config.focusAreas.domainPatterns) areas.push('Domain pattern analysis (identify industry verticals, company types, TLD patterns)');
  if (config.focusAreas.roleAnalysis) areas.push('Role/position analysis (infer roles from email prefixes: ceo@, marketing@, dev@, etc.)');
  if (config.focusAreas.providerDistribution) areas.push('Email provider distribution (business domains vs free providers, Google Workspace vs M365 vs self-hosted)');
  if (config.focusAreas.authQuality) areas.push('Domain authentication quality (SPF/DMARC adoption, infrastructure maturity)');
  if (config.focusAreas.geographicHints) areas.push('Geographic inference from TLDs (.uk, .de, .in, .io, etc.)');
  if (config.focusAreas.riskCorrelation) areas.push('Risk factor correlation (which characteristics correlate with higher/lower risk scores)');

  const depth = config.analysisDepth === 'deep' ? 'extremely thorough and detailed' : config.analysisDepth === 'standard' ? 'balanced with good detail' : 'concise and focused on key findings';

  return `You are an expert B2B data analyst specializing in Ideal Customer Profile (ICP) analysis.
You are analyzing a list of email leads that have been through verification. Your analysis should be ${depth}.

${config.industry ? `INDUSTRY CONTEXT: The business operates in the "${config.industry}" industry.` : ''}
${config.targetAudience ? `TARGET AUDIENCE: ${config.targetAudience}` : ''}
${config.customContext ? `ADDITIONAL CONTEXT: ${config.customContext}` : ''}

FOCUS AREAS:
${areas.map((a, i) => `${i + 1}. ${a}`).join('\n')}

ANALYSIS REQUIREMENTS:
1. Build a clear ICP profile with:
   - A 2-3 sentence summary of the ideal customer from this data
   - Ideal domain types, roles, providers
   - Red flags to avoid
   - Strength indicators

2. Identify 3-6 distinct segments in the data, each with:
   - Name and description
   - ICP match percentage (0-100)
   - Lead count estimate
   - 3-5 sample emails
   - Key characteristics
   - Recommended action

3. Generate actionable insights categorized as:
   - opportunity: untapped potential in the data
   - warning: risks or quality concerns
   - pattern: notable data patterns
   - recommendation: specific actions to take

4. Provide distribution breakdowns for domain types, roles, providers, and auth quality.

Respond in this exact JSON format:
{
  "profile": {
    "summary": "...",
    "idealDomainTypes": ["..."],
    "idealRoles": ["..."],
    "idealProviders": ["..."],
    "redFlags": ["..."],
    "strengthIndicators": ["..."]
  },
  "segments": [
    {
      "name": "...",
      "description": "...",
      "matchPercentage": 85,
      "leadCount": 42,
      "sampleEmails": ["..."],
      "characteristics": ["..."],
      "recommendedAction": "..."
    }
  ],
  "insights": [
    {
      "category": "opportunity",
      "title": "...",
      "description": "...",
      "impact": "high"
    }
  ],
  "distribution": {
    "domainTypes": [{"label": "SaaS/Tech", "count": 30, "percentage": 45}],
    "roleTypes": [{"label": "Decision Maker", "count": 20, "percentage": 30}],
    "providerTypes": [{"label": "Google Workspace", "count": 25, "percentage": 38}],
    "authQuality": [{"label": "Full Auth (SPF+DMARC)", "count": 40, "percentage": 60}]
  }
}`;
}

function buildUserPrompt(leads: any[], _config: ICPConfig): string {
  const simplified = leads.map(l => ({
    email: l.email,
    classification: l.classification,
    risk: l.riskScore,
    role: l.checks?.roleBased?.detected ? l.checks.roleBased.prefix : null,
    freeProvider: l.checks?.freeProvider?.detected ? l.checks.freeProvider.category : null,
    catchAll: l.checks?.catchAll ?? null,
    spf: l.checks?.domainAuth?.spf ?? null,
    dmarc: l.checks?.domainAuth?.dmarc ?? null,
    domainAgeDays: l.checks?.domainAge?.ageDays ?? null,
    smtp: l.checks?.smtpResult?.status || 'unknown',
    dnsblListed: l.checks?.dnsbl?.listed ?? null,
  }));

  return `Analyze these ${simplified.length} verified email leads and build an ICP:\n\n${JSON.stringify(simplified, null, 2)}`;
}

export default router;
