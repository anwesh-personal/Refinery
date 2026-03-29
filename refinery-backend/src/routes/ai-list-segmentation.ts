import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { callAIJSON } from '../services/aiClient.js';

const router = Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════
// AI List Segmentation — Feature #3
//
// Groups verified leads into intelligent segments based on
// configurable criteria. Each segment gets actionable strategy.
// ═══════════════════════════════════════════════════════════

export interface SegmentationConfig {
  // How many segments to create
  targetSegments: number;       // 2-10
  // Segmentation criteria (toggleable)
  criteria: {
    roleHierarchy: boolean;      // Decision maker / Influencer / Gatekeeper / Individual
    companySize: boolean;        // Infer from domain patterns (startup / mid-market / enterprise)
    industryVertical: boolean;   // Infer from domain names
    engagementReadiness: boolean;// Based on verification quality + auth
    riskProfile: boolean;        // Group by risk levels
    geographicRegion: boolean;   // Infer from TLD
  };
  // Strategy generation
  generateCampaignStrategy: boolean;  // Generate email campaign strategy per segment
  generateSubjectLines: boolean;      // Generate sample subject lines per segment
  // Context
  productDescription: string;    // What you're selling/promoting
  campaignGoal: string;          // e.g. "Book demos", "Drive signups", "Announce product launch"
  customCriteria: string;        // Free-form segmentation criteria
  // Filtering
  includeClassifications: string[];
  maxLeads: number;
}

export interface SegmentGroup {
  name: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  leadCount: number;
  emails: string[];
  characteristics: string[];
  campaignStrategy?: {
    approach: string;
    tone: string;
    keyMessages: string[];
    subjectLines?: string[];
    callToAction: string;
    bestSendTime: string;
  };
  estimatedResponseRate: string;
}

export interface SegmentationResult {
  segments: SegmentGroup[];
  overallStrategy: {
    summary: string;
    sequenceRecommendation: string;
    estimatedTotalReach: number;
    warnings: string[];
  };
  ai: { provider: string; model: string; latencyMs: number; wasFallback: boolean; tokensUsed?: number };
}

const DEFAULT_CONFIG: SegmentationConfig = {
  targetSegments: 4,
  criteria: {
    roleHierarchy: true,
    companySize: true,
    industryVertical: true,
    engagementReadiness: true,
    riskProfile: true,
    geographicRegion: false,
  },
  generateCampaignStrategy: true,
  generateSubjectLines: true,
  productDescription: '',
  campaignGoal: '',
  customCriteria: '',
  includeClassifications: ['safe', 'uncertain'],
  maxLeads: 200,
};

// ─── POST /api/ai/list-segmentation ───

router.post('/', async (req, res) => {
  try {
    const { leads, config: userConfig } = req.body;
    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'leads array is required' });
    }

    const config: SegmentationConfig = {
      ...DEFAULT_CONFIG, ...userConfig,
      criteria: { ...DEFAULT_CONFIG.criteria, ...userConfig?.criteria },
    };

    let filtered = leads;
    if (config.includeClassifications.length > 0) {
      filtered = filtered.filter((l: any) => config.includeClassifications.includes(l.classification));
    }
    filtered = filtered.slice(0, config.maxLeads);

    if (filtered.length === 0) {
      return res.status(400).json({ error: 'No leads match the filter criteria' });
    }

    const systemPrompt = buildSystemPrompt(config);
    const userPrompt = buildUserPrompt(filtered, config);

    const { data, raw } = await callAIJSON<SegmentationResult>(
      'list_segmentation',
      systemPrompt,
      userPrompt,
      { maxTokens: config.generateCampaignStrategy ? 10240 : 6144, temperature: 0.4 }
    );

    if (!data || !raw.success) {
      return res.status(502).json({ error: raw.error || 'Segmentation failed', ai: { provider: raw.providerLabel, model: raw.model, latencyMs: raw.latencyMs, wasFallback: raw.wasFallback } });
    }

    data.ai = { provider: raw.providerLabel, model: raw.model, latencyMs: raw.latencyMs, wasFallback: raw.wasFallback, tokensUsed: raw.tokensUsed };
    res.json(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/config', (_req, res) => { res.json({ config: DEFAULT_CONFIG }); });

// ─── Prompts ───

function buildSystemPrompt(config: SegmentationConfig): string {
  const criteria: string[] = [];
  if (config.criteria.roleHierarchy) criteria.push('Role Hierarchy: Classify by decision-making power (C-suite/VP → Decision Maker, Director/Manager → Influencer, Admin/Support → Gatekeeper, Personal/Generic → Individual Contributor)');
  if (config.criteria.companySize) criteria.push('Company Size: Infer from domain patterns (custom domains → business, complexity → enterprise, .io/.co → startup/tech)');
  if (config.criteria.industryVertical) criteria.push('Industry Vertical: Infer from domain names, keywords in email prefixes');
  if (config.criteria.engagementReadiness) criteria.push('Engagement Readiness: Score by verification quality (SMTP verified + SPF/DMARC → high readiness, catch-all/uncertain → medium, risky → low)');
  if (config.criteria.riskProfile) criteria.push('Risk Profile: Group by verification risk score and blacklist status');
  if (config.criteria.geographicRegion) criteria.push('Geographic Region: Infer from TLD (.uk → UK/Europe, .in → India/APAC, .de → DACH, .com → Global/US)');

  return `You are an expert email marketing strategist and data segmentation specialist.

TASK: Segment the provided email leads into ${config.targetSegments} meaningful groups for targeted outreach.

SEGMENTATION CRITERIA (use these to group leads):
${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${config.customCriteria ? `CUSTOM CRITERIA:\n${config.customCriteria}` : ''}

${config.productDescription ? `PRODUCT/SERVICE: ${config.productDescription}` : ''}
${config.campaignGoal ? `CAMPAIGN GOAL: ${config.campaignGoal}` : ''}

FOR EACH SEGMENT, provide:
- name: Clear, actionable segment name
- description: What defines this group
- priority: high/medium/low (based on expected value)
- leadCount: How many leads in this segment
- emails: Complete list of emails in this segment
- characteristics: Key traits (3-5 items)
- estimatedResponseRate: Expected response rate (e.g. "3-5%")
${config.generateCampaignStrategy ? `- campaignStrategy:
  - approach: Overall strategy for this segment
  - tone: Communication tone (professional/casual/urgent/educational)
  - keyMessages: 3-4 key messaging points
  ${config.generateSubjectLines ? '- subjectLines: 3-4 email subject line options' : ''}
  - callToAction: Primary CTA
  - bestSendTime: Recommended send time/day` : ''}

ALSO provide overallStrategy:
- summary: Overall campaign approach across all segments
- sequenceRecommendation: Which segments to contact first and why
- estimatedTotalReach: Total reachable leads
- warnings: Any concerns or caveats

IMPORTANT: Every email from the input MUST appear in exactly ONE segment. No email should be missing or duplicated.

Respond as JSON:
{
  "segments": [...],
  "overallStrategy": { "summary": "...", "sequenceRecommendation": "...", "estimatedTotalReach": 0, "warnings": [] }
}`;
}

function buildUserPrompt(leads: any[], _config: SegmentationConfig): string {
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
  return `Segment these ${simplified.length} email leads:\n\n${JSON.stringify(simplified, null, 2)}`;
}

export default router;
