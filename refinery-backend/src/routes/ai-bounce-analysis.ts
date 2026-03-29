import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { callAIJSON } from '../services/aiClient.js';

const router = Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════
// AI Bounce Analysis — Feature #4
//
// Pre-send deliverability analysis: predicts bounce rates,
// identifies problematic domains, analyzes SMTP patterns,
// and recommends list hygiene actions.
// ═══════════════════════════════════════════════════════════

export interface BounceAnalysisConfig {
  analysisMode: 'pre_send' | 'post_campaign';
  focusAreas: {
    smtpPatterns: boolean;         // Analyze SMTP response codes & patterns
    domainHealth: boolean;         // Per-domain deliverability health
    infrastructureRisk: boolean;   // SPF/DMARC/DNSBL correlation
    catchAllRisk: boolean;         // Catch-all domain bounce prediction
    providerAnalysis: boolean;     // ISP/provider-specific patterns
    temporalPatterns: boolean;     // Domain age & freshness correlation
  };
  riskTolerance: 'conservative' | 'balanced' | 'aggressive';
  campaignType: string;            // e.g. "cold outreach", "newsletter", "transactional"
  senderReputation: 'new' | 'established' | 'warm';
  customContext: string;
  includeClassifications: string[];
  maxLeads: number;
}

export interface DomainHealthReport {
  domain: string;
  leadCount: number;
  healthScore: number;            // 0-100
  predictedBounceRate: string;
  riskLevel: 'safe' | 'caution' | 'danger';
  issues: string[];
  recommendations: string[];
}

export interface BounceAnalysisResult {
  overview: {
    totalAnalyzed: number;
    predictedBounceRate: string;
    predictedHardBounces: number;
    predictedSoftBounces: number;
    safeToSend: number;
    needsReview: number;
    doNotSend: number;
    overallRisk: 'low' | 'medium' | 'high' | 'critical';
  };
  domainHealth: DomainHealthReport[];
  patterns: {
    category: string;
    finding: string;
    affectedCount: number;
    severity: 'info' | 'warning' | 'critical';
    action: string;
  }[];
  recommendations: {
    priority: 'immediate' | 'before_send' | 'ongoing';
    title: string;
    description: string;
    estimatedImpact: string;
  }[];
  riskBreakdown: {
    label: string;
    count: number;
    percentage: number;
    color: string;
  }[];
  ai: { provider: string; model: string; latencyMs: number; wasFallback: boolean; tokensUsed?: number };
}

const DEFAULT_CONFIG: BounceAnalysisConfig = {
  analysisMode: 'pre_send',
  focusAreas: { smtpPatterns: true, domainHealth: true, infrastructureRisk: true, catchAllRisk: true, providerAnalysis: true, temporalPatterns: true },
  riskTolerance: 'balanced',
  campaignType: '',
  senderReputation: 'established',
  customContext: '',
  includeClassifications: ['safe', 'uncertain', 'risky'],
  maxLeads: 300,
};

router.post('/', async (req, res) => {
  try {
    const { leads, config: userConfig } = req.body;
    if (!leads?.length) return res.status(400).json({ error: 'leads array required' });

    const config: BounceAnalysisConfig = { ...DEFAULT_CONFIG, ...userConfig, focusAreas: { ...DEFAULT_CONFIG.focusAreas, ...userConfig?.focusAreas } };

    let filtered = leads;
    if (config.includeClassifications.length > 0) filtered = filtered.filter((l: any) => config.includeClassifications.includes(l.classification));
    filtered = filtered.slice(0, config.maxLeads);
    if (!filtered.length) return res.status(400).json({ error: 'No leads match filters' });

    const systemPrompt = buildSystemPrompt(config);
    const userPrompt = buildUserPrompt(filtered, config);

    const { data, raw } = await callAIJSON<BounceAnalysisResult>('bounce_analysis', systemPrompt, userPrompt, { maxTokens: 10240, temperature: 0.2 });
    if (!data || !raw.success) return res.status(502).json({ error: raw.error || 'Analysis failed', ai: { provider: raw.providerLabel, model: raw.model, latencyMs: raw.latencyMs } });

    data.ai = { provider: raw.providerLabel, model: raw.model, latencyMs: raw.latencyMs, wasFallback: raw.wasFallback, tokensUsed: raw.tokensUsed };
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/config', (_req, res) => { res.json({ config: DEFAULT_CONFIG }); });

function buildSystemPrompt(config: BounceAnalysisConfig): string {
  const areas: string[] = [];
  if (config.focusAreas.smtpPatterns) areas.push('SMTP Response Pattern Analysis: Analyze SMTP status codes (250=delivered, 550=hard bounce, 421/450=soft bounce, etc.) and their distribution');
  if (config.focusAreas.domainHealth) areas.push('Domain Health Scoring: Per-domain deliverability health report with health score (0-100)');
  if (config.focusAreas.infrastructureRisk) areas.push('Infrastructure Risk: SPF/DMARC presence correlation with deliverability, DNSBL listing impact');
  if (config.focusAreas.catchAllRisk) areas.push('Catch-All Risk: Identify catch-all domains and estimate hidden bounce risk (catch-all may accept during SMTP check but bounce later)');
  if (config.focusAreas.providerAnalysis) areas.push('Provider Analysis: ISP/provider-specific deliverability patterns (Gmail, Outlook, Yahoo attitude to cold email)');
  if (config.focusAreas.temporalPatterns) areas.push('Temporal Risk: Domain age correlation with bounce rates (new domains = higher risk)');

  const tolerance = config.riskTolerance === 'conservative' ? 'Flag anything with even minor risk. Err heavily on the side of caution — sender reputation is paramount.' :
    config.riskTolerance === 'aggressive' ? 'Only flag high-confidence bounce risks. Tolerate moderate uncertainty — maximize reach.' :
    'Balance between reach and safety. Flag clear risks but accept reasonable uncertainty.';

  return `You are an expert email deliverability analyst specializing in bounce prediction and list hygiene.

ANALYSIS MODE: ${config.analysisMode === 'pre_send' ? 'Pre-Send Analysis — predict bounce rates BEFORE sending' : 'Post-Campaign — analyze actual bounce patterns'}

RISK TOLERANCE: ${tolerance}
${config.campaignType ? `CAMPAIGN TYPE: ${config.campaignType}` : ''}
SENDER REPUTATION: ${config.senderReputation} (${config.senderReputation === 'new' ? 'very cautious — cannot afford hard bounces' : config.senderReputation === 'warm' ? 'building reputation — moderate caution' : 'established — can tolerate some risk'})
${config.customContext ? `CONTEXT: ${config.customContext}` : ''}

FOCUS AREAS:
${areas.map((a, i) => `${i + 1}. ${a}`).join('\n')}

ANALYSIS REQUIREMENTS:
1. overview: total stats, predicted bounce rate, hard/soft bounce counts, safe/review/doNotSend counts, overall risk level
2. domainHealth: per-domain report (top domains) with healthScore (0-100), predictedBounceRate, riskLevel, issues, recommendations
3. patterns: identified patterns (SMTP code clusters, domain patterns, infrastructure gaps) with severity and action
4. recommendations: prioritized actions (immediate/before_send/ongoing) with estimated impact
5. riskBreakdown: categorized risk distribution with suggested color coding

BOUNCE PREDICTION FACTORS:
- SMTP 250 = good, but catch-all domains may still bounce
- No SMTP check = unknown risk (risky)
- Missing SPF/DMARC = slightly higher bounce risk (less trusted by receiving servers)
- DNSBL-listed = HIGH bounce risk
- Disposable domains = DEFINITE bounce
- New domains (<90 days) = elevated risk
- Free email providers = variable (Gmail strict, Yahoo moderate)
- Role-based emails (info@, admin@) = slightly higher bounce rate

Respond in JSON matching the BounceAnalysisResult type. For riskBreakdown colors use: safe=#10a37f, caution=#ffd700, danger=#ff6b35, critical=#ef4444.`;
}

function buildUserPrompt(leads: any[], _config: BounceAnalysisConfig): string {
  const simplified = leads.map(l => ({
    email: l.email, classification: l.classification, risk: l.riskScore,
    smtp: l.checks?.smtpResult?.status || 'unknown', smtpCode: l.checks?.smtpResult?.code || 0,
    catchAll: l.checks?.catchAll ?? null, disposable: l.checks?.disposable ?? null,
    spf: l.checks?.domainAuth?.spf ?? null, dmarc: l.checks?.domainAuth?.dmarc ?? null,
    dnsblListed: l.checks?.dnsbl?.listed ?? null, domainAgeDays: l.checks?.domainAge?.ageDays ?? null,
    freeProvider: l.checks?.freeProvider?.detected ? l.checks.freeProvider.category : null,
    roleBased: l.checks?.roleBased?.detected ? l.checks.roleBased.prefix : null,
    mx: l.checks?.mxValid?.valid ?? null,
  }));
  return `Analyze bounce risk for these ${simplified.length} email leads:\n\n${JSON.stringify(simplified, null, 2)}`;
}

export default router;
