-- ═══════════════════════════════════════════════════════════
-- MIGRATION 014: AI Agent Knowledge Base + Management
--
-- Per-agent knowledge base entries for RAG context injection.
-- Superadmin-managed training data and custom instructions.
-- ═══════════════════════════════════════════════════════════

-- ── Knowledge Base ──
CREATE TABLE IF NOT EXISTS ai_agent_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES ai_agents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',  -- general, instructions, examples, data, reference
  enabled BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,       -- higher = injected first
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_kb_agent ON ai_agent_knowledge(agent_id, enabled, priority DESC);

-- Add columns to ai_agents for extended customization
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS temperature DECIMAL(3,2) DEFAULT 0.5;
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS max_tokens INTEGER DEFAULT 4096;
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS custom_instructions TEXT DEFAULT '';
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- RLS
ALTER TABLE ai_agent_knowledge ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view agent KB" ON ai_agent_knowledge;
CREATE POLICY "Anyone can view agent KB" ON ai_agent_knowledge FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Superadmins manage agent KB" ON ai_agent_knowledge;
CREATE POLICY "Superadmins manage agent KB" ON ai_agent_knowledge FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin'));
