# 06 — Memory System

## Purpose
Without memory, every conversation starts from zero. The memory system gives agents continuity across sessions.

---

## Architecture

### Two Layers

1. **Conversation Summary** — After each conversation ends (or after N messages), generate a 2-3 sentence summary and store it. Next conversation, the agent gets the last 5 summaries (~150 tokens).

2. **User Preferences** — Track what the user cares about (e.g., "User always wants business emails only", "User's main segment is SaaS-Decision-Makers"). Stored as key-value pairs.

### Storage

**Table: `agent_memory`** (Supabase)
```sql
CREATE TABLE public.agent_memory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_slug TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  memory_type TEXT NOT NULL,          -- 'conversation_summary' | 'user_preference' | 'fact'
  content TEXT NOT NULL,              -- The actual memory content
  priority INT DEFAULT 5,            -- 1-10, higher = more important
  conversation_id UUID,              -- Which conversation this came from (for summaries)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ             -- Optional TTL for temporary memories
);

CREATE INDEX idx_agent_memory_lookup ON agent_memory(agent_slug, user_id, memory_type);
```

### Summarization Flow

```
Conversation ends (user closes chat or 10 min idle)
  → Collect all messages from conversation
  → Send to LLM: "Summarize this conversation in 2-3 sentences. Focus on:
     what the user asked for, what actions were taken, what the outcome was."
  → Store summary in agent_memory with type='conversation_summary'
  → Cap at 20 summaries per agent+user (delete oldest when exceeded)
```

### Injection

At conversation start, after the system manifest:
```
MEMORY — Recent Interactions:
- [2026-03-28] User verified 136K emails from the March dataset. 89K safe, 12K risky. Job ID: c91ezzgh.
- [2026-03-27] User asked about bounce rates for the SaaS segment. Average was 4.2%.
- [2026-03-26] User created segment "Enterprise-IT-Directors" with 23K leads.

User Preferences:
- Prefers business emails only (exclude free providers)
- Main focus: SaaS B2B outreach
- Verification threshold: max risk score 40
```

**Cost**: ~150-200 tokens per conversation start. Negligible.

---

## Implementation

```typescript
// agents/memory.ts

import { supabase } from '../lib/supabase';

/** Get recent memories for an agent+user pair */
export async function getMemories(
  agentSlug: string,
  userId: string,
  limit = 5
): Promise<string> {
  const { data: summaries } = await supabase
    .from('agent_memory')
    .select('content, created_at')
    .eq('agent_slug', agentSlug)
    .eq('user_id', userId)
    .eq('memory_type', 'conversation_summary')
    .order('created_at', { ascending: false })
    .limit(limit);

  const { data: prefs } = await supabase
    .from('agent_memory')
    .select('content')
    .eq('agent_slug', agentSlug)
    .eq('user_id', userId)
    .eq('memory_type', 'user_preference');

  let memoryBlock = '';

  if (summaries?.length) {
    memoryBlock += 'MEMORY — Recent Interactions:\n';
    for (const s of summaries) {
      const date = new Date(s.created_at).toISOString().split('T')[0];
      memoryBlock += `- [${date}] ${s.content}\n`;
    }
  }

  if (prefs?.length) {
    memoryBlock += '\nUser Preferences:\n';
    for (const p of prefs) {
      memoryBlock += `- ${p.content}\n`;
    }
  }

  return memoryBlock;
}

/** Generate and store a conversation summary */
export async function summarizeAndStore(
  agentSlug: string,
  userId: string,
  conversationId: string,
  messages: Array<{ role: string; content: string }>
): Promise<void> {
  // Use a lightweight model for summarization (fastest available)
  const summary = await generateSummary(messages);

  await supabase.from('agent_memory').insert({
    agent_slug: agentSlug,
    user_id: userId,
    memory_type: 'conversation_summary',
    content: summary,
    conversation_id: conversationId,
  });

  // Cap at 20 summaries per agent+user
  const { data: all } = await supabase
    .from('agent_memory')
    .select('id, created_at')
    .eq('agent_slug', agentSlug)
    .eq('user_id', userId)
    .eq('memory_type', 'conversation_summary')
    .order('created_at', { ascending: true });

  if (all && all.length > 20) {
    const toDelete = all.slice(0, all.length - 20).map(r => r.id);
    await supabase.from('agent_memory').delete().in('id', toDelete);
  }
}
```
