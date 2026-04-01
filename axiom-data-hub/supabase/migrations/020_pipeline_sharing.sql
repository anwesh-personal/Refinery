-- ═══════════════════════════════════════════════════════════
-- Pipeline Job Sharing — Google Drive-style per-job access
--
-- Jobs live in ClickHouse (pipeline_jobs table).
-- Shares live here in Postgres (relational, queryable).
-- Owner = performed_by column in ClickHouse.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pipeline_job_shares (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          TEXT NOT NULL,                          -- ClickHouse pipeline_jobs.id
  owner_id        UUID NOT NULL REFERENCES auth.users(id),-- user who owns the job
  shared_with_id  UUID NOT NULL REFERENCES auth.users(id),-- user gaining access
  permissions     JSONB NOT NULL DEFAULT '{"can_read": true, "can_vault": false, "can_download": false}'::jsonb,
  shared_by       UUID NOT NULL REFERENCES auth.users(id),-- who performed the share action
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate shares
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_shares_unique
  ON pipeline_job_shares(job_id, shared_with_id);

-- Fast lookups: "what jobs are shared with me?"
CREATE INDEX IF NOT EXISTS idx_pipeline_shares_shared_with
  ON pipeline_job_shares(shared_with_id);

-- Fast lookups: "who has access to this job?"
CREATE INDEX IF NOT EXISTS idx_pipeline_shares_job
  ON pipeline_job_shares(job_id);

-- RLS
ALTER TABLE pipeline_job_shares ENABLE ROW LEVEL SECURITY;

-- Superadmins can do anything
CREATE POLICY "superadmin_full_access" ON pipeline_job_shares
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin')
  );

-- Owners can manage shares for their jobs
CREATE POLICY "owner_manage_shares" ON pipeline_job_shares
  FOR ALL USING (owner_id = auth.uid());

-- Shared users can see their own share records
CREATE POLICY "shared_user_read" ON pipeline_job_shares
  FOR SELECT USING (shared_with_id = auth.uid());
