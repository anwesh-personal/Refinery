-- Add min_file_size_mb column to ingestion_rules
ALTER TABLE ingestion_rules ADD COLUMN IF NOT EXISTS min_file_size_mb Nullable(Float64) DEFAULT NULL;
