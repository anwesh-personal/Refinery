import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { callAIJSON, type AICallResult } from '../services/aiClient.js';

const router = Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════
// AI-Powered Lead Scoring — Feature #1
//
// Takes verification results and sends them to AI for:
// - Quality scoring (0-100)
// - Classification tier (Platinum / Gold / Silver / Bronze / Dead)
// - Reasoning per lead
// - Actionable recommendations
// - Batch processing with configurable parameters
//
// All scoring criteria are sent to AI as part of the prompt -
// fully configurable from the frontend, zero hardcoded logic.
// ═══════════════════════════════════════════════════════════

// ─── Types ───

export interface LeadInput {
  email: string;
  classification: string;        // from verification: safe/uncertain/risky/reject
  riskScore: number;
  checks: {
    syntax?: { passed: boolean };
    roleBased?: { detected: boolean; prefix: string | null };
    freeProvider?: { detected: boolean; category: string | null };
    catchAll?: boolean;
    domainAuth?: { spf: boolean; dmarc: boolean; authScore: number };
    domainAge?: { ageDays: number; isNew: boolean };
    dnsbl?: { listed: boolean; listings: string[] };
    smtpResult?: { status: string; code: number };
    mxValid?: { valid: boolean; mxCount: number };
    disposable?: boolean;
  };
}

export interface ScoringConfig {
  // Weight multipliers (user-configurable, 0-10 scale)
  weights: {
    verificationStatus: number;    // How much the verification classification matters
    domainReputation: number;      // SPF/DKIM/DMARC/domain age
    deliverability: number;        // SMTP result, catch-all, MX
    businessValue: number;         // Role-based vs personal, free vs business
    blacklistStatus: number;       // DNSBL listings
  };
  // Tier thresholds (score ranges)
  tiers: {
    platinum: number;  // score >= this
    gold: number;
    silver: number;
    bronze: number;
    // below bronze = Dead
  };
  // Custom scoring instructions (free-form text the AI uses)
  customInstructions: string;
  // B2B mode: penalize free providers, boost business domains
  b2bMode: boolean;
  // Include per-lead reasoning
  includeReasoning: boolean;
  // Maximum leads per batch (prevent token explosion)
  batchSize: number;
}

export interface ScoredLead {
  email: string;
  score: number;                 // 0-100
  tier: 'platinum' | 'gold' | 'silver' | 'bronze' | 'dead';
  reasoning: string;
  signals: string[];             // Key signals that influenced the score
  recommendation: string;        // Actionable next step
}

export interface ScoringResult {
  leads: ScoredLead[];
  summary: {
    totalScored: number;
    tierBreakdown: Record<string, number>;
    avgScore: number;
    topSignals: string[];        // Most common signals across all leads
    recommendations: string[];   // High-level recommendations
  };
  ai: {
    provider: string;
    model: string;
    latencyMs: number;
    wasFallback: boolean;
    tokensUsed?: number;
  };
}

const DEFAULT_CONFIG: ScoringConfig = {
  weights: {
    verificationStatus: 8,
    domainReputation: 7,
    deliverability: 9,
    businessValue: 6,
    blacklistStatus: 10,
  },
  tiers: {
    platinum: 90,
    gold: 75,
    silver: 55,
    bronze: 35,
  },
  customInstructions: '',
  b2bMode: false,
  includeReasoning: true,
  batchSize: 50,
};

// ─── POST /api/ai/lead-scoring — Score a batch of leads ───

router.post('/', async (req, res) => {
  try {
    const { leads, config: userConfig } = req.body as { leads: LeadInput[]; config?: Partial<ScoringConfig> };

    if (!leads || !Array.isArray(leads) || leads.length === 0) {
      return res.status(400).json({ error: 'leads array is required and must not be empty' });
    }

    const config: ScoringConfig = { ...DEFAULT_CONFIG, ...userConfig, weights: { ...DEFAULT_CONFIG.weights, ...userConfig?.weights }, tiers: { ...DEFAULT_CONFIG.tiers, ...userConfig?.tiers } };

    // Enforce batch size
    const batch = leads.slice(0, config.batchSize);

    const systemPrompt = buildSystemPrompt(config);
    const userPrompt = buildUserPrompt(batch, config);

    const { data, raw } = await callAIJSON<{ leads: ScoredLead[]; summary: { topSignals: string[]; recommendations: string[] } }>(
      'lead_scoring',
      systemPrompt,
      userPrompt,
      { maxTokens: 8192, temperature: 0.2 }
    );

    if (!data || !raw.success) {
      return res.status(502).json({
        error: raw.error || 'AI scoring failed',
        ai: { provider: raw.providerLabel, model: raw.model, latencyMs: raw.latencyMs, wasFallback: raw.wasFallback },
      });
    }

    // Calculate summary
    const scoredLeads = data.leads || [];
    const tierBreakdown: Record<string, number> = { platinum: 0, gold: 0, silver: 0, bronze: 0, dead: 0 };
    let totalScore = 0;
    for (const l of scoredLeads) {
      tierBreakdown[l.tier] = (tierBreakdown[l.tier] || 0) + 1;
      totalScore += l.score;
    }

    const result: ScoringResult = {
      leads: scoredLeads,
      summary: {
        totalScored: scoredLeads.length,
        tierBreakdown,
        avgScore: scoredLeads.length > 0 ? Math.round(totalScore / scoredLeads.length) : 0,
        topSignals: data.summary?.topSignals || [],
        recommendations: data.summary?.recommendations || [],
      },
      ai: {
        provider: raw.providerLabel,
        model: raw.model,
        latencyMs: raw.latencyMs,
        wasFallback: raw.wasFallback,
        tokensUsed: raw.tokensUsed,
      },
    };

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/ai/lead-scoring/config — Get default config ───

router.get('/config', (_req, res) => {
  res.json({ config: DEFAULT_CONFIG });
});

// ─── Prompt Construction ───

function buildSystemPrompt(config: ScoringConfig): string {
  return `You are an expert email lead quality analyst. Your job is to score email leads based on their verification data.

SCORING RULES:
- Score each lead from 0 (worthless) to 100 (perfect).
- Use these weight priorities (1-10 scale, higher = more important):
  • Verification Status: ${config.weights.verificationStatus}/10
  • Domain Reputation (SPF/DMARC/domain age): ${config.weights.domainReputation}/10
  • Deliverability (SMTP result, catch-all, MX): ${config.weights.deliverability}/10
  • Business Value (role-based, free vs business): ${config.weights.businessValue}/10
  • Blacklist Status: ${config.weights.blacklistStatus}/10

TIER CLASSIFICATION:
- Platinum: score >= ${config.tiers.platinum} (highest quality, verified business leads)
- Gold: score >= ${config.tiers.gold} (strong leads, minor concerns)
- Silver: score >= ${config.tiers.silver} (acceptable, some risk factors)
- Bronze: score >= ${config.tiers.bronze} (low quality, significant concerns)
- Dead: score < ${config.tiers.bronze} (do not use, likely invalid or harmful)

${config.b2bMode ? `B2B MODE ACTIVE:
- Free email providers (Gmail, Yahoo, etc.) should receive a significant score penalty
- Business domains with proper authentication (SPF+DMARC) should receive a bonus
- Role-based emails (info@, sales@) at business domains are acceptable in B2B context` : ''}

${config.customInstructions ? `ADDITIONAL INSTRUCTIONS:\n${config.customInstructions}` : ''}

NEGATIVE SIGNALS (reduce score):
- Disposable email domains → heavy penalty
- DNSBL-listed domains → heavy penalty
- Failed SMTP verification → significant penalty
- Catch-all domains → moderate penalty (may accept any address)
- New domains (< 90 days) → moderate penalty
- Missing SPF/DMARC → minor penalty
- Role-based emails (info@, admin@) → minor penalty (unless B2B mode)

POSITIVE SIGNALS (increase score):
- Verified SMTP (250 response) → strong boost
- Both SPF and DMARC present → moderate boost
- Established domain (> 1 year) → moderate boost
- Business domain (not free provider) → minor boost
- Clean DNSBL check → baseline expectation

For each lead, provide:
- score (0-100)
- tier (platinum/gold/silver/bronze/dead)
${config.includeReasoning ? '- reasoning (1-2 sentence explanation)' : ''}
- signals (array of key factors, e.g. ["verified_smtp", "missing_dmarc", "free_provider"])
- recommendation (one actionable step)

Also provide a summary with:
- topSignals: most common signals across all leads
- recommendations: 2-3 high-level recommendations for this batch

Respond in this exact JSON format:
{
  "leads": [
    {
      "email": "...",
      "score": 85,
      "tier": "gold",
      "reasoning": "...",
      "signals": ["verified_smtp", "established_domain"],
      "recommendation": "Safe to include in campaigns"
    }
  ],
  "summary": {
    "topSignals": ["verified_smtp", "missing_dmarc"],
    "recommendations": ["Add DMARC monitoring for domains without it", "Remove DNSBL-listed leads before send"]
  }
}`;
}

function buildUserPrompt(leads: LeadInput[], _config: ScoringConfig): string {
  const simplified = leads.map(l => ({
    email: l.email,
    verification: l.classification,
    risk: l.riskScore,
    smtp: l.checks.smtpResult?.status || 'unknown',
    smtpCode: l.checks.smtpResult?.code || 0,
    mx: l.checks.mxValid?.valid ?? null,
    catchAll: l.checks.catchAll ?? null,
    roleBased: l.checks.roleBased?.detected ? l.checks.roleBased.prefix : null,
    freeProvider: l.checks.freeProvider?.detected ? l.checks.freeProvider.category : null,
    disposable: l.checks.disposable ?? null,
    spf: l.checks.domainAuth?.spf ?? null,
    dmarc: l.checks.domainAuth?.dmarc ?? null,
    authScore: l.checks.domainAuth?.authScore ?? null,
    domainAgeDays: l.checks.domainAge?.ageDays ?? null,
    isNewDomain: l.checks.domainAge?.isNew ?? null,
    dnsblListed: l.checks.dnsbl?.listed ?? null,
    dnsblListings: l.checks.dnsbl?.listings || [],
  }));

  return `Score these ${simplified.length} email leads:\n\n${JSON.stringify(simplified, null, 2)}`;
}

export default router;
