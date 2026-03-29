-- ═══════════════════════════════════════════════════════════
-- MIGRATION 015: Agent Provider Cascade
--
-- Adds per-agent provider/model override columns to ai_agents.
-- Adds `agent_chat` to ai_service_config as the system default.
--
-- Resolution order (backend):
--   1. Agent's own provider_id + model_id (explicit override)
--   2. `agent_chat` service config (system default for all agents)
--   3. First enabled provider with a selected_model (ultimate fallback)
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════

-- ── Add provider/model columns to ai_agents ──
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES ai_providers(id) ON DELETE SET NULL;
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS model_id TEXT DEFAULT '';

-- ── Seed the system-wide agent_chat service config ──
INSERT INTO ai_service_config (service_slug, service_name)
VALUES ('agent_chat', 'AI Agent Chat (System Default)')
ON CONFLICT (service_slug) DO NOTHING;
