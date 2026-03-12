-- Create a locked-down read-only role for the NLQ app.
-- Run this as the land_registry superuser / owner.

-- 1. Create the role (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nlq_readonly') THEN
    -- Set a strong password via: ALTER ROLE nlq_readonly PASSWORD 'your-secret';
    CREATE ROLE nlq_readonly LOGIN PASSWORD 'CHANGE_ME_BEFORE_DEPLOY';
  END IF;
END
$$;

-- 2. Revoke inherited PUBLIC privileges (default Postgres grants CONNECT, TEMP, CREATE on public)
REVOKE ALL ON DATABASE land_registry FROM PUBLIC;
GRANT CONNECT ON DATABASE land_registry TO land_registry; -- restore owner access
REVOKE ALL ON DATABASE land_registry FROM nlq_readonly;
GRANT CONNECT ON DATABASE land_registry TO nlq_readonly;

-- 3. Lock down schema public — revoke PUBLIC defaults, then grant minimal access
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM nlq_readonly;
GRANT USAGE ON SCHEMA public TO nlq_readonly;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM nlq_readonly;
GRANT SELECT ON property_sales TO nlq_readonly;

-- 4. pg_catalog and information_schema
-- PostgreSQL hardcodes access to pg_catalog — REVOKE USAGE has no effect.
-- The AST validator blocks these schemas at the application layer.
-- Revoke PUBLIC default so nlq_readonly can't inherit it, then restore for the owner.
REVOKE USAGE ON SCHEMA information_schema FROM PUBLIC;
GRANT USAGE ON SCHEMA information_schema TO land_registry;
REVOKE USAGE ON SCHEMA information_schema FROM nlq_readonly;

-- 5. Per-role defaults: statement timeout + log slow queries
ALTER ROLE nlq_readonly SET statement_timeout = '10s';
ALTER ROLE nlq_readonly SET log_min_duration_statement = '5s';
