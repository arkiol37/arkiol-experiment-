-- Arkiol database initialization
-- This runs once when the PostgreSQL container is first created

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pg_trgm for full-text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create dev database (already created by POSTGRES_DB env var)
-- Grant all privileges
GRANT ALL PRIVILEGES ON DATABASE arkiol_dev TO arkiol;

-- Set timezone
SET timezone = 'UTC';
