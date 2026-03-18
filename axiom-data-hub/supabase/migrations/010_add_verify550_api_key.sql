-- Add verify550_api_key column to profiles for per-user API key storage
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS verify550_api_key TEXT DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN profiles.verify550_api_key IS 'Per-user Verify550 API secret. If set, overrides org-wide key from system_config.';
