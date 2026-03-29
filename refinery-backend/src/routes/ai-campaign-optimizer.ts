import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { callAIJSON } from '../services/aiClient.js';

const router = Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════
// AI Campaign Optimizer — Feature #7
//
// Analyzes all available data (verification, scores, segments,
// enrichment) to recommend optimal campaign parameters:
// send timing, volume pacing, domain rotation, warmup strategy.
// ═══════════════════════════════════════════════════════════

export interface OptimizerConfig {
  optimizationGoals: {
    maximizeDeliverability: boolean;
    maximizeOpenRate: boolean;
    maximizeReplyRate: boolean;
    minimizeBounceRate: boolean;
    minimizeSpamComplaints: boolean;
  };
  constraints: {
    dailySendLimit: number;       // Max emails per day
    warmupRequired: boolean;      // Is this a new sender domain?
    multiDomainAvailable: boolean;// Multiple sending domains available?
    sendingDomainCount: number;   // How many sending domains
    timeZone: string;             // Primary recipient timezone
  };
  campaignContext: {
    campaignType: string;         // cold_outreach, newsletter, etc.
    listSize: number;
    previousCampaignData: string; // Any past performance data (free-form)
    industry: string;
    audienceType: string;         // B2B, B2C, mixed
  };
  advancedOptions: {
    analyzeSendWindows: boolean;  // Optimal send time analysis
    volumePacing: boolean;        // Ramp-up strategy
    domainRotation: boolean;      // Multi-domain rotation strategy
    subjectLineOptimization: boolean; // A/B testing recommendations
    reputationProtection: boolean;    // Sender reputation safeguards
  };
  customObjectives: string;
}

export interface OptimizerResult {
  strategy: {
    summary: string;
    overallApproach: string;
    estimatedPerformance: {
      deliverabilityRate: string;
      openRate: string;
      replyRate: string;
      bounceRate: string;
    };
  };
  sendSchedule: {
    optimalDays: string[];
    optimalHours: { hour: string; quality: 'peak' | 'good' | 'acceptable' }[];
    avoidTimes: string[];
    timezone: string;
  };
  volumeStrategy: {
    phase: string;
    dailyVolume: number;
    duration: string;
    description: string;
  }[];
  domainStrategy?: {
    rotationPattern: string;
    perDomainLimit: number;
    warmupSchedule: string;
    recommendations: string[];
  };
  abTestRecommendations: {
    variable: string;
    variationA: string;
    variationB: string;
    sampleSize: string;
    expectedInsight: string;
  }[];
  reputationSafeguards: {
    rule: string;
    reason: string;
    priority: 'critical' | 'important' | 'recommended';
  }[];
  warnings: string[];
  ai: { provider: string; model: string; latencyMs: number; wasFallback: boolean; tokensUsed?: number };
}

const DEFAULT_CONFIG: OptimizerConfig = {
  optimizationGoals: { maximizeDeliverability: true, maximizeOpenRate: true, maximizeReplyRate: true, minimizeBounceRate: true, minimizeSpamComplaints: true },
  constraints: { dailySendLimit: 500, warmupRequired: false, multiDomainAvailable: false, sendingDomainCount: 1, timeZone: 'America/New_York' },
  campaignContext: { campaignType: 'cold_outreach', listSize: 0, previousCampaignData: '', industry: '', audienceType: 'B2B' },
  advancedOptions: { analyzeSendWindows: true, volumePacing: true, domainRotation: true, subjectLineOptimization: true, reputationProtection: true },
  customObjectives: '',
};

router.post('/', async (req, res) => {
  try {
    const { leads, config: userConfig } = req.body;
    const config: OptimizerConfig = {
      ...DEFAULT_CONFIG, ...userConfig,
      optimizationGoals: { ...DEFAULT_CONFIG.optimizationGoals, ...userConfig?.optimizationGoals },
      constraints: { ...DEFAULT_CONFIG.constraints, ...userConfig?.constraints },
      campaignContext: { ...DEFAULT_CONFIG.campaignContext, ...userConfig?.campaignContext, listSize: leads?.length || userConfig?.campaignContext?.listSize || 0 },
      advancedOptions: { ...DEFAULT_CONFIG.advancedOptions, ...userConfig?.advancedOptions },
    };

    const systemPrompt = buildSystemPrompt(config);
    let userPrompt = buildUserPrompt(config);

    // If leads provided, summarize them for context
    if (leads?.length) {
      const summary = summarizeLeads(leads);
      userPrompt += `\n\nLEAD DATA SUMMARY:\n${JSON.stringify(summary, null, 2)}`;
    }

    const { data, raw } = await callAIJSON<OptimizerResult>(
      'campaign_optimizer',
      systemPrompt,
      userPrompt,
      { maxTokens: 10240, temperature: 0.3 }
    );

    if (!data || !raw.success) return res.status(502).json({ error: raw.error || 'Optimization failed' });
    data.ai = { provider: raw.providerLabel, model: raw.model, latencyMs: raw.latencyMs, wasFallback: raw.wasFallback, tokensUsed: raw.tokensUsed };
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/config', (_req, res) => { res.json({ config: DEFAULT_CONFIG }); });

function summarizeLeads(leads: any[]) {
  const total = leads.length;
  const classifications: Record<string, number> = {};
  const domains = new Set<string>();
  let totalRisk = 0; let catchAllCount = 0; let freeCount = 0; let dnsblCount = 0;
  for (const l of leads) {
    classifications[l.classification] = (classifications[l.classification] || 0) + 1;
    const d = l.email.split('@')[1]; if (d) domains.add(d);
    totalRisk += l.riskScore || 0;
    if (l.checks?.catchAll) catchAllCount++;
    if (l.checks?.freeProvider?.detected) freeCount++;
    if (l.checks?.dnsbl?.listed) dnsblCount++;
  }
  return {
    totalLeads: total, uniqueDomains: domains.size,
    classifications, avgRiskScore: Math.round(totalRisk / total),
    catchAllPercentage: Math.round((catchAllCount / total) * 100),
    freeProviderPercentage: Math.round((freeCount / total) * 100),
    dnsblListedCount: dnsblCount,
  };
}

function buildSystemPrompt(config: OptimizerConfig): string {
  const goals: string[] = [];
  if (config.optimizationGoals.maximizeDeliverability) goals.push('Maximize inbox placement / deliverability');
  if (config.optimizationGoals.maximizeOpenRate) goals.push('Maximize open rates');
  if (config.optimizationGoals.maximizeReplyRate) goals.push('Maximize reply/response rates');
  if (config.optimizationGoals.minimizeBounceRate) goals.push('Minimize bounce rates');
  if (config.optimizationGoals.minimizeSpamComplaints) goals.push('Minimize spam complaints');

  const sections: string[] = [];
  if (config.advancedOptions.analyzeSendWindows) sections.push('SEND SCHEDULE: Recommend optimal days, hours, and times to avoid based on audience type and timezone');
  if (config.advancedOptions.volumePacing) sections.push('VOLUME PACING: Create a multi-phase volume ramp-up strategy with daily volumes and durations');
  if (config.advancedOptions.domainRotation && config.constraints.multiDomainAvailable) sections.push('DOMAIN ROTATION: Strategy for distributing sends across multiple domains');
  if (config.advancedOptions.subjectLineOptimization) sections.push('A/B TESTING: Recommend 3-5 A/B test experiments with variables, variations, and sample sizes');
  if (config.advancedOptions.reputationProtection) sections.push('REPUTATION SAFEGUARDS: Rules to protect sender reputation (critical/important/recommended)');

  return `You are an expert email campaign strategist and deliverability consultant.

OPTIMIZATION GOALS (prioritized):
${goals.map((g, i) => `${i + 1}. ${g}`).join('\n')}

CONSTRAINTS:
- Daily send limit: ${config.constraints.dailySendLimit}
- Warmup required: ${config.constraints.warmupRequired ? 'YES — this is a new/cold sender domain' : 'No — sender is established'}
- Sending domains: ${config.constraints.sendingDomainCount} ${config.constraints.multiDomainAvailable ? '(multi-domain rotation available)' : '(single domain)'}
- Recipient timezone: ${config.constraints.timeZone}

CAMPAIGN:
- Type: ${config.campaignContext.campaignType}
- List size: ${config.campaignContext.listSize || 'Unknown'}
- Audience: ${config.campaignContext.audienceType}
${config.campaignContext.industry ? `- Industry: ${config.campaignContext.industry}` : ''}
${config.campaignContext.previousCampaignData ? `- Previous data: ${config.campaignContext.previousCampaignData}` : ''}

${config.customObjectives ? `CUSTOM OBJECTIVES:\n${config.customObjectives}` : ''}

ANALYSIS SECTIONS:
${sections.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Respond in JSON:
{
  "strategy": {"summary": "...", "overallApproach": "...", "estimatedPerformance": {"deliverabilityRate": "95-98%", "openRate": "20-30%", "replyRate": "3-5%", "bounceRate": "<2%"}},
  "sendSchedule": {"optimalDays": [...], "optimalHours": [{"hour": "9 AM", "quality": "peak"}], "avoidTimes": [...], "timezone": "..."},
  "volumeStrategy": [{"phase": "Warmup", "dailyVolume": 50, "duration": "Week 1", "description": "..."}],
  ${config.constraints.multiDomainAvailable ? '"domainStrategy": {"rotationPattern": "...", "perDomainLimit": 0, "warmupSchedule": "...", "recommendations": [...]},' : ''}
  "abTestRecommendations": [{"variable": "Subject Line", "variationA": "...", "variationB": "...", "sampleSize": "...", "expectedInsight": "..."}],
  "reputationSafeguards": [{"rule": "...", "reason": "...", "priority": "critical"}],
  "warnings": [...]
}`;
}

function buildUserPrompt(config: OptimizerConfig): string {
  return `Optimize this email campaign:\n\n${JSON.stringify({
    goals: config.optimizationGoals, constraints: config.constraints,
    campaign: config.campaignContext, advancedOptions: config.advancedOptions,
  }, null, 2)}`;
}

export default router;
