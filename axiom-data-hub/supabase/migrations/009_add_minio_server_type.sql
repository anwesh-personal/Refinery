-- Migration 009: Add 'minio' as a valid server type
-- Replaces Linode Object Storage with generic MinIO/S3-compatible storage

-- Drop the old CHECK constraint and add a new one that includes 'minio'
ALTER TABLE servers DROP CONSTRAINT IF EXISTS servers_type_check;
ALTER TABLE servers ADD CONSTRAINT servers_type_check
  CHECK (type IN ('clickhouse', 's3', 'linode', 'minio'));

-- Migrate existing 'linode' entries to 'minio'
UPDATE servers SET type = 'minio' WHERE type = 'linode';

-- Update the comment
COMMENT ON COLUMN servers.type IS 'Server type: clickhouse, s3, or minio';
COMMENT ON COLUMN servers.endpoint_url IS 'Custom endpoint for MinIO or S3-compatible storage';
