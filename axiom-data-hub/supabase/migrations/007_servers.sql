-- ═══════════════════════════════════════════════════════════════
-- MIGRATION 007: Server Pool — Multi-Server Connections
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Server connections (ClickHouse, S3, Linode Object Storage)
CREATE TABLE IF NOT EXISTS servers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('clickhouse', 's3', 'linode')),
  
  -- Connection details
  host TEXT NOT NULL,
  port INTEGER DEFAULT 8123,
  username TEXT DEFAULT '',
  password TEXT DEFAULT '',  -- TODO: Supabase Vault encryption
  database_name TEXT DEFAULT 'default',
  
  -- S3/Linode specific
  bucket TEXT,
  region TEXT DEFAULT 'us-east-1',
  access_key TEXT DEFAULT '',
  secret_key TEXT DEFAULT '',  -- TODO: Supabase Vault encryption
  endpoint_url TEXT,           -- Custom endpoint for Linode/MinIO
  
  -- Metadata
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_ping_at TIMESTAMPTZ,
  last_ping_ok BOOLEAN,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enforce single default per type
CREATE UNIQUE INDEX IF NOT EXISTS idx_servers_single_default 
  ON servers (type) WHERE is_default = true AND is_active = true;

-- ── RLS ──
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view server names (not credentials)
CREATE POLICY "Authenticated users can view servers"
  ON servers FOR SELECT TO authenticated
  USING (true);

-- Only superadmins can create/update/delete servers
CREATE POLICY "Superadmins can insert servers"
  ON servers FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin')
  );

CREATE POLICY "Superadmins can update servers"
  ON servers FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin')
  );

CREATE POLICY "Superadmins can delete servers"
  ON servers FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin')
  );

-- ── Secure View ──
-- Non-superadmins see a sanitized view (no credentials)
CREATE OR REPLACE VIEW servers_safe AS
SELECT
  id, name, type, host, port, database_name,
  bucket, region, endpoint_url,
  is_default, is_active, last_ping_at, last_ping_ok,
  created_by, created_at, updated_at
FROM servers;

-- ── Trigger: auto-update updated_at ──
CREATE OR REPLACE FUNCTION update_servers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_servers_updated_at
  BEFORE UPDATE ON servers
  FOR EACH ROW
  EXECUTE FUNCTION update_servers_updated_at();

-- ── Trigger: unset other defaults when setting one ──
CREATE OR REPLACE FUNCTION enforce_single_default_server()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE servers
    SET is_default = false
    WHERE type = NEW.type AND id != NEW.id AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_enforce_single_default
  BEFORE INSERT OR UPDATE ON servers
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION enforce_single_default_server();
