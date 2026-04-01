/**
 * Reembed All KB Entries
 * 
 * Proper one-off script using the backend's own env config and embedding service.
 * Run: npx tsx src/scripts/reembed-kb.ts [agentSlug]
 * 
 * If agentSlug is provided, only re-embeds that agent's entries.
 * Otherwise, re-embeds ALL agents.
 */

import '../config/env.js';
import { supabaseAdmin } from '../services/supabaseAdmin.js';
import { reembedAll } from '../services/embeddings.js';

async function main() {
  const targetSlug = process.argv[2];

  if (targetSlug) {
    // Re-embed for a specific agent
    const { data: agent } = await supabaseAdmin
      .from('ai_agents')
      .select('id, slug, name')
      .eq('slug', targetSlug)
      .single();

    if (!agent) {
      console.error(`Agent "${targetSlug}" not found.`);
      process.exit(1);
    }

    console.log(`\n🔄 Re-embedding KB entries for: ${agent.name} (${agent.slug})`);
    const result = await reembedAll(agent.id);
    console.log(`✅ Done: ${result.success} embedded, ${result.failed} failed\n`);
  } else {
    // Re-embed ALL agents
    const { data: agents } = await supabaseAdmin
      .from('ai_agents')
      .select('id, slug, name')
      .order('name');

    if (!agents?.length) {
      console.error('No agents found.');
      process.exit(1);
    }

    console.log(`\n🔄 Re-embedding KB for ${agents.length} agents...\n`);

    let totalSuccess = 0, totalFailed = 0;
    for (const agent of agents) {
      // Count entries for this agent
      const { count } = await supabaseAdmin
        .from('ai_agent_knowledge')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agent.id)
        .eq('enabled', true);

      if (!count) {
        console.log(`  ⏭  ${agent.name} (${agent.slug}): no KB entries, skipping`);
        continue;
      }

      console.log(`  🔄 ${agent.name} (${agent.slug}): ${count} entries...`);
      const result = await reembedAll(agent.id);
      totalSuccess += result.success;
      totalFailed += result.failed;
      console.log(`     ✅ ${result.success} embedded, ${result.failed} failed`);
    }

    console.log(`\n═══════════════════════════════════`);
    console.log(`Total: ${totalSuccess} embedded, ${totalFailed} failed`);
    console.log(`═══════════════════════════════════\n`);
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
