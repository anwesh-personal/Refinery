import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { callAIJSON } from '../services/aiClient.js';

const router = Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════════
// AI Content Generation — Feature #6
//
// Generates email copy: subject lines, body content, CTAs,
// follow-up sequences — based on ICP, segment, and campaign context.
// ═══════════════════════════════════════════════════════════

export interface ContentConfig {
  contentType: 'cold_outreach' | 'follow_up' | 'newsletter' | 'announcement' | 're_engagement' | 'custom';
  tone: 'professional' | 'casual' | 'urgent' | 'educational' | 'witty' | 'empathetic';
  length: 'short' | 'medium' | 'long';      // short=2-3 sentences, medium=paragraph, long=multi-paragraph
  audience: {
    segment: string;           // e.g. "Tech Decision Makers"
    seniority: string;         // e.g. "C-Suite", "Manager"
    industry: string;
    painPoints: string;        // e.g. "Slow onboarding, high churn"
  };
  campaign: {
    product: string;           // What you're promoting
    valueProposition: string;  // Why it matters
    goal: string;             // Book demo, sign up, read article
    urgency: string;          // e.g. "Limited spots", "Price increase", none
  };
  generation: {
    subjectLineCount: number;     // How many subject lines to generate
    bodyVariations: number;       // How many body copy variations
    includePS: boolean;           // Include P.S. line
    includePersonalization: boolean; // Include {{firstName}}, {{companyName}} placeholders
    generateFollowUps: number;    // Number of follow-up emails (0 = none)
    avoidSpamTriggers: boolean;   // Actively avoid spam trigger words
  };
  brand: {
    companyName: string;
    senderName: string;
    signatureStyle: 'minimal' | 'professional' | 'friendly';
  };
  customInstructions: string;
}

export interface GeneratedEmail {
  subjectLine: string;
  preheader: string;
  body: string;
  callToAction: string;
  psLine?: string;
}

export interface ContentResult {
  subjectLines: { text: string; type: string; estimatedOpenRate: string }[];
  emailVariations: GeneratedEmail[];
  followUps: { dayDelay: number; subjectLine: string; body: string; purpose: string }[];
  spamAnalysis: { score: number; flaggedWords: string[]; suggestions: string[] };
  copywritingTips: string[];
  ai: { provider: string; model: string; latencyMs: number; wasFallback: boolean; tokensUsed?: number };
}

const DEFAULT_CONFIG: ContentConfig = {
  contentType: 'cold_outreach',
  tone: 'professional',
  length: 'medium',
  audience: { segment: '', seniority: '', industry: '', painPoints: '' },
  campaign: { product: '', valueProposition: '', goal: '', urgency: '' },
  generation: { subjectLineCount: 5, bodyVariations: 3, includePS: true, includePersonalization: true, generateFollowUps: 2, avoidSpamTriggers: true },
  brand: { companyName: '', senderName: '', signatureStyle: 'professional' },
  customInstructions: '',
};

router.post('/', async (req, res) => {
  try {
    const { config: userConfig } = req.body;
    const config: ContentConfig = {
      ...DEFAULT_CONFIG, ...userConfig,
      audience: { ...DEFAULT_CONFIG.audience, ...userConfig?.audience },
      campaign: { ...DEFAULT_CONFIG.campaign, ...userConfig?.campaign },
      generation: { ...DEFAULT_CONFIG.generation, ...userConfig?.generation },
      brand: { ...DEFAULT_CONFIG.brand, ...userConfig?.brand },
    };

    if (!config.campaign.product && !config.campaign.valueProposition) {
      return res.status(400).json({ error: 'Product or value proposition is required' });
    }

    const { data, raw } = await callAIJSON<ContentResult>(
      'content_generation',
      buildSystemPrompt(config),
      buildUserPrompt(config),
      { maxTokens: 10240, temperature: 0.7 }
    );

    if (!data || !raw.success) return res.status(502).json({ error: raw.error || 'Generation failed' });
    data.ai = { provider: raw.providerLabel, model: raw.model, latencyMs: raw.latencyMs, wasFallback: raw.wasFallback, tokensUsed: raw.tokensUsed };
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.get('/config', (_req, res) => { res.json({ config: DEFAULT_CONFIG }); });

function buildSystemPrompt(config: ContentConfig): string {
  const length = config.length === 'short' ? '2-3 sentences max. Ultra-concise.' : config.length === 'long' ? 'Multi-paragraph. Detailed and persuasive.' : 'One solid paragraph. Clear and focused.';
  const sig = config.brand.signatureStyle === 'minimal' ? 'Just name' : config.brand.signatureStyle === 'friendly' ? 'First name with casual sign-off' : 'Full name, title, company';

  return `You are an elite email copywriter specializing in high-converting B2B email campaigns.

CONTENT TYPE: ${config.contentType.replace(/_/g, ' ')}
TONE: ${config.tone}
LENGTH: ${length}

AUDIENCE:
${config.audience.segment ? `- Segment: ${config.audience.segment}` : ''}
${config.audience.seniority ? `- Seniority: ${config.audience.seniority}` : ''}
${config.audience.industry ? `- Industry: ${config.audience.industry}` : ''}
${config.audience.painPoints ? `- Pain Points: ${config.audience.painPoints}` : ''}

CAMPAIGN:
- Product: ${config.campaign.product || 'Not specified'}
- Value Prop: ${config.campaign.valueProposition || 'Not specified'}
- Goal: ${config.campaign.goal || 'Generate interest'}
${config.campaign.urgency ? `- Urgency: ${config.campaign.urgency}` : ''}

BRAND:
${config.brand.companyName ? `- Company: ${config.brand.companyName}` : ''}
${config.brand.senderName ? `- Sender: ${config.brand.senderName}` : ''}
- Signature: ${sig}

GENERATION RULES:
- Generate ${config.generation.subjectLineCount} subject lines with variety (curiosity, benefit, question, social proof, direct)
- Generate ${config.generation.bodyVariations} body copy variations with distinct approaches
${config.generation.includePersonalization ? '- Include personalization tokens: {{firstName}}, {{companyName}}, {{role}} where natural' : '- Do NOT use personalization tokens'}
${config.generation.includePS ? '- Include a compelling P.S. line' : ''}
${config.generation.avoidSpamTriggers ? '- ACTIVELY avoid spam trigger words: free, guarantee, act now, limited time, click here, buy now, etc.' : ''}
${config.generation.generateFollowUps > 0 ? `- Generate ${config.generation.generateFollowUps} follow-up emails with increasing urgency and different angles` : ''}

${config.customInstructions ? `CUSTOM INSTRUCTIONS:\n${config.customInstructions}` : ''}

QUALITY STANDARDS:
- Every subject line should be under 50 characters
- Hook within first 7 words
- One clear CTA per email
- No generic filler ("I hope this email finds you well")
- Write like a human, not a bot
- Provide preheader text (the preview line in inbox, 40-90 chars)

SPAM ANALYSIS: After generating content, analyze it for:
- Spam score (0-100, lower = better)
- Any flagged words that might trigger spam filters
- Suggestions to improve deliverability

Respond in JSON:
{
  "subjectLines": [{"text": "...", "type": "curiosity|benefit|question|social_proof|direct", "estimatedOpenRate": "25-30%"}],
  "emailVariations": [{"subjectLine": "...", "preheader": "...", "body": "...", "callToAction": "...", "psLine": "..."}],
  "followUps": [{"dayDelay": 3, "subjectLine": "...", "body": "...", "purpose": "..."}],
  "spamAnalysis": {"score": 15, "flaggedWords": [], "suggestions": []},
  "copywritingTips": ["..."]
}`;
}

function buildUserPrompt(config: ContentConfig): string {
  return `Generate email campaign content with these specifications:\n\n${JSON.stringify({
    type: config.contentType, tone: config.tone, length: config.length,
    audience: config.audience, campaign: config.campaign, brand: config.brand,
  }, null, 2)}`;
}

export default router;
