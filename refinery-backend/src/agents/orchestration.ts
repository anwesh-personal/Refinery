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

interface ParsedIntent {
  mode: 'parallel' | 'chain' | 'debate';
  agents: string[];      // ordered list of agent slugs
  question: string;       // the actual question (mentions stripped)
  debateRounds?: number;  // for debate mode
}

const NAME_TO_SLUG: Record<string, string> = {
  cipher: 'data_scientist',
  sentinel: 'smtp_specialist',
  oracle: 'seo_strategist',
  crucible: 'supervisor',
  argus: 'verification_engineer',
};

const ALL_SLUGS = Object.values(NAME_TO_SLUG);

export function parseIntent(message: string): ParsedIntent {
  const lower = message.toLowerCase();

  // Check for "then" pattern → chain mode
  const thenMatch = lower.match(/@(\w+)\s+then\s+@(\w+)/);
  if (thenMatch) {
    const a = NAME_TO_SLUG[thenMatch[1]] || thenMatch[1];
    const b = NAME_TO_SLUG[thenMatch[2]] || thenMatch[2];
    const question = message.replace(/@\w+\s+then\s+@\w+/i, '').trim();
    return { mode: 'chain', agents: [a, b], question };
  }

  // Check for "vs" pattern → debate mode
  const vsMatch = lower.match(/@(\w+)\s+vs\.?\s+@(\w+)/);
  if (vsMatch) {
    const a = NAME_TO_SLUG[vsMatch[1]] || vsMatch[1];
    const b = NAME_TO_SLUG[vsMatch[2]] || vsMatch[2];
    const question = message.replace(/@\w+\s+vs\.?\s+@\w+/i, '').trim();
    return { mode: 'debate', agents: [a, b], question, debateRounds: 2 };
  }

  // Check for @all
  if (/@all\b/i.test(lower)) {
    const question = message.replace(/@all/i, '').trim();
    return { mode: 'parallel', agents: ALL_SLUGS, question };
  }

  // Check for individual @mentions
  const mentions: string[] = [];
  for (const [name, slug] of Object.entries(NAME_TO_SLUG)) {
    if (lower.includes(`@${name}`)) mentions.push(slug);
  }

  if (mentions.length > 0) {
    let question = message;
    for (const name of Object.keys(NAME_TO_SLUG)) {
      question = question.replace(new RegExp(`@${name}`, 'gi'), '').trim();
    }
    return { mode: 'parallel', agents: mentions, question };
  }

  // No mentions → all agents
  return { mode: 'parallel', agents: ALL_SLUGS, question: message };
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
