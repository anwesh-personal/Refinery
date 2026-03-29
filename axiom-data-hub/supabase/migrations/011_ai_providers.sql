-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 011: AI Provider Instances & Service Config
-- Run in Supabase SQL Editor
--
-- Each row in ai_providers = ONE API key instance.
-- Multiple keys per LLM type allowed (e.g. 3 Anthropic keys = 3 rows).
-- Services independently reference which provider+model to use.
-- ═══════════════════════════════════════════════════════════════

-- ── AI Provider Instances ──
CREATE TABLE IF NOT EXISTS ai_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Provider type (which LLM family)
  provider_type TEXT NOT NULL CHECK (provider_type IN (
    'anthropic', 'gemini', 'openai', 'mistral', 'private_vps', 'ollama'
  )),
  
  -- User-defined label (e.g. "Anthropic Production", "Claude Backup #2")
  label TEXT NOT NULL,
  
  -- Credentials
  api_key TEXT DEFAULT '',          -- Encrypted at rest by Supabase
  endpoint TEXT DEFAULT '',         -- Required for private_vps and ollama
  
  -- State
  enabled BOOLEAN NOT NULL DEFAULT false,
  validated BOOLEAN NOT NULL DEFAULT false,
  last_validated_at TIMESTAMPTZ,
  
  -- Cached models fetched from the provider API (stored as JSON array of strings)
  cached_models JSONB NOT NULL DEFAULT '[]'::jsonb,
  models_fetched_at TIMESTAMPTZ,
  
  -- Selected default model for this provider instance
  selected_model TEXT DEFAULT '',
  
  -- Global priority (lower = higher priority, used for fallback ordering)
  priority INTEGER NOT NULL DEFAULT 100,
  
  -- Metadata
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups by provider type
CREATE INDEX IF NOT EXISTS idx_ai_providers_type ON ai_providers(provider_type);
CREATE INDEX IF NOT EXISTS idx_ai_providers_priority ON ai_providers(priority, enabled);

-- ── AI Service Config ──
-- Maps service features to specific provider+model combinations
CREATE TABLE IF NOT EXISTS ai_service_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Service identifier (unique per feature)
  service_slug TEXT NOT NULL UNIQUE,
  service_name TEXT NOT NULL,       -- Human-readable name
  
  -- Primary provider + model
  provider_id UUID REFERENCES ai_providers(id) ON DELETE SET NULL,
  model_id TEXT DEFAULT '',
  
  -- Fallback provider + model (used when primary fails)
  fallback_provider_id UUID REFERENCES ai_providers(id) ON DELETE SET NULL,
  fallback_model_id TEXT DEFAULT '',
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── RLS ──
ALTER TABLE ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_service_config ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view providers (keys masked in API, not exposed here)
CREATE POLICY "Authenticated users can view AI providers"
  ON ai_providers FOR SELECT TO authenticated
  USING (true);

-- Only superadmins can create/update/delete providers
CREATE POLICY "Superadmins can insert AI providers"
  ON ai_providers FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin')
  );

CREATE POLICY "Superadmins can update AI providers"
  ON ai_providers FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin')
  );

CREATE POLICY "Superadmins can delete AI providers"
  ON ai_providers FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin')
  );

-- Service config — same RLS pattern
CREATE POLICY "Authenticated users can view AI service config"
  ON ai_service_config FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Superadmins can insert AI service config"
  ON ai_service_config FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin')
  );

CREATE POLICY "Superadmins can update AI service config"
  ON ai_service_config FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin')
  );

CREATE POLICY "Superadmins can delete AI service config"
  ON ai_service_config FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin')
  );

-- ── Safe View (hides api_key for non-superadmins) ──
CREATE OR REPLACE VIEW ai_providers_safe AS
SELECT
  id, provider_type, label, endpoint,
  CASE WHEN length(api_key) > 12
    THEN left(api_key, 8) || repeat('•', greatest(length(api_key) - 12, 0)) || right(api_key, 4)
    ELSE repeat('•', length(api_key))
  END AS api_key_masked,
  (api_key IS NOT NULL AND api_key != '') AS api_key_set,
  enabled, validated, last_validated_at,
  cached_models, models_fetched_at, selected_model,
  priority, created_by, created_at, updated_at
FROM ai_providers;

-- ── Triggers: auto-update updated_at ──
CREATE OR REPLACE FUNCTION update_ai_providers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_ai_providers_updated_at
  BEFORE UPDATE ON ai_providers
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_providers_updated_at();

CREATE OR REPLACE FUNCTION update_ai_service_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_ai_service_config_updated_at
  BEFORE UPDATE ON ai_service_config
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_service_config_updated_at();

-- ── Seed well-known services (so UI has options before any AI features are built) ──
INSERT INTO ai_service_config (service_slug, service_name) VALUES
  ('lead_scoring',       'Lead Scoring & Classification'),
  ('icp_analysis',       'ICP Analysis'),
  ('list_segmentation',  'List Segmentation'),
  ('content_generation', 'Content Generation'),
  ('bounce_analysis',    'Bounce Analysis'),
  ('data_enrichment',    'Data Enrichment'),
  ('campaign_optimizer', 'Campaign Optimizer')
ON CONFLICT (service_slug) DO NOTHING;
