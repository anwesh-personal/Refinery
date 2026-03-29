-- ═══════════════════════════════════════════════════════════
-- MIGRATION 017: AI Boardroom Meetings
--
-- Multi-agent orchestration: select agents, ask a question,
-- each agent delivers a department report, Crucible synthesizes.
-- ═══════════════════════════════════════════════════════════

-- ── Boardroom Meetings ──
CREATE TABLE IF NOT EXISTS ai_boardroom_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  title TEXT NOT NULL DEFAULT 'New Meeting',
  question TEXT NOT NULL,
  agent_slugs TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'consolidating', 'complete', 'failed')),
  executive_summary TEXT,
  error TEXT,
  total_tokens INTEGER DEFAULT 0,
  total_latency_ms INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_boardroom_user ON ai_boardroom_meetings(user_id, created_at DESC);

-- ── Individual Agent Reports ──
CREATE TABLE IF NOT EXISTS ai_boardroom_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES ai_boardroom_meetings(id) ON DELETE CASCADE,
  agent_slug TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  report_content TEXT,
  tools_used TEXT[] DEFAULT '{}',
  tokens_used INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'complete', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_boardroom_reports_meeting ON ai_boardroom_reports(meeting_id);

-- ── RLS ──
ALTER TABLE ai_boardroom_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_boardroom_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "boardroom_meetings_user" ON ai_boardroom_meetings
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "boardroom_reports_user" ON ai_boardroom_reports
  FOR ALL USING (
    meeting_id IN (SELECT id FROM ai_boardroom_meetings WHERE user_id = auth.uid())
  );
