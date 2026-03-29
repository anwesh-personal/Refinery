// ═══════════════════════════════════════════════════════════
// Boardroom Orchestration Modes
// Handles chain mode and debate mode for multi-agent interactions
// ═══════════════════════════════════════════════════════════

/**
 * Parse the user's message to detect orchestration mode.
 *
 * Patterns:
 *   "@Cipher then @Sentinel" → chain mode
 *   "@Cipher vs @Oracle"     → debate mode
 *   "@Cipher @Sentinel"      → parallel (default boardroom)
 *   "@all"                   → all agents parallel
 *   "just text"              → all agents parallel
 */

import { supabaseAdmin } from '../services/supabaseAdmin.js';

interface ParsedIntent {
  mode: 'parallel' | 'chain' | 'debate';
  agents: string[];      // ordered list of agent slugs
  question: string;       // the actual question (mentions stripped)
  debateRounds?: number;  // for debate mode
}

// ── Dynamic agent name→slug resolution (cached 5min) ──
let nameSlugCache: Record<string, string> = {};
let allSlugsCache: string[] = [];
let cacheTs = 0;

async function ensureAgentCache(): Promise<void> {
  if (Object.keys(nameSlugCache).length > 0 && (Date.now() - cacheTs) < 5 * 60 * 1000) return;
  const { data } = await supabaseAdmin.from('ai_agents').select('slug, name').eq('enabled', true);
  nameSlugCache = {};
  allSlugsCache = [];
  for (const a of (data || [])) {
    nameSlugCache[a.name.toLowerCase()] = a.slug;
    allSlugsCache.push(a.slug);
  }
  cacheTs = Date.now();
}

function resolveSlug(name: string): string {
  return nameSlugCache[name] || name;
}

export async function parseIntent(message: string): Promise<ParsedIntent> {
  await ensureAgentCache();
  const lower = message.toLowerCase();

  // Check for "then" pattern → chain mode
  const thenMatch = lower.match(/@(\w+)\s+then\s+@(\w+)/);
  if (thenMatch) {
    const a = resolveSlug(thenMatch[1]);
    const b = resolveSlug(thenMatch[2]);
    const question = message.replace(/@\w+\s+then\s+@\w+/i, '').trim();
    return { mode: 'chain', agents: [a, b], question };
  }

  // Check for "vs" pattern → debate mode
  const vsMatch = lower.match(/@(\w+)\s+vs\.?\s+@(\w+)/);
  if (vsMatch) {
    const a = resolveSlug(vsMatch[1]);
    const b = resolveSlug(vsMatch[2]);
    const question = message.replace(/@\w+\s+vs\.?\s+@\w+/i, '').trim();
    return { mode: 'debate', agents: [a, b], question, debateRounds: 2 };
  }

  // Check for @all
  if (/@all\b/i.test(lower)) {
    const question = message.replace(/@all/i, '').trim();
    return { mode: 'parallel', agents: [...allSlugsCache], question };
  }

  // Check for individual @mentions
  const mentions: string[] = [];
  for (const [name, slug] of Object.entries(nameSlugCache)) {
    if (lower.includes(`@${name}`)) mentions.push(slug);
  }

  if (mentions.length > 0) {
    let question = message;
    for (const name of Object.keys(nameSlugCache)) {
      question = question.replace(new RegExp(`@${name}`, 'gi'), '').trim();
    }
    return { mode: 'parallel', agents: mentions, question };
  }

  // No mentions → all agents
  return { mode: 'parallel', agents: [...allSlugsCache], question: message };
}

/**
 * Build the chain prompt — inject Agent A's response into Agent B's context
 */
export function buildChainPrompt(
  previousAgentName: string,
  previousResponse: string,
  question: string
): string {
  return `The user asked: "${question}"

${previousAgentName} already analyzed this and provided the following response:

---
${previousResponse}
---

Now it's your turn. Build on ${previousAgentName}'s analysis. Add your own perspective, correct any mistakes, and provide additional insights from your domain.`;
}

/**
 * Build the debate prompt — inject the opponent's argument
 */
export function buildDebatePrompt(
  opponentName: string,
  opponentResponse: string,
  question: string,
  round: number,
  isFirstRound: boolean
): string {
  if (isFirstRound) {
    return `DEBATE MODE — You are debating ${opponentName} on the following topic:

"${question}"

Present your position clearly and back it with data from your tools. Be respectful but firm. This is Round ${round}.`;
  }

  return `DEBATE MODE — Round ${round}

${opponentName} responded:
---
${opponentResponse}
---

Counter their arguments. Use data and evidence. Be constructive but challenge weak points.`;
}
