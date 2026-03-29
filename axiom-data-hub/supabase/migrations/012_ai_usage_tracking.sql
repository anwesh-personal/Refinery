-- ═══════════════════════════════════════════════════════════
-- MIGRATION 012: AI Usage Tracking
--
-- Logs every AI API call: service, provider, model, tokens,
-- latency, success/fail, cost estimate. Powers the AI Dashboard.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What service made this call
  service_slug TEXT NOT NULL,

  -- Which provider was used
  provider_id UUID REFERENCES ai_providers(id) ON DELETE SET NULL,
  provider_type TEXT NOT NULL DEFAULT '',
  provider_label TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',

  -- Call metrics
  tokens_used INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,

  -- Outcome
  success BOOLEAN NOT NULL DEFAULT true,
  was_fallback BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT DEFAULT '',

  -- Cost tracking (estimated, per provider pricing — filled by backend)
  estimated_cost_usd DECIMAL(10, 6) NOT NULL DEFAULT 0,

  -- Who triggered it
  triggered_by UUID REFERENCES profiles(id),

  -- When
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_ai_usage_service ON ai_usage_log(service_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage_log(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_time ON ai_usage_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_success ON ai_usage_log(success, created_at DESC);

-- RLS
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view AI usage"
  ON ai_usage_log FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "System can insert AI usage"
  ON ai_usage_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- Superadmin delete (cleanup)
CREATE POLICY "Superadmins can delete AI usage"
  ON ai_usage_log FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin')
  );
