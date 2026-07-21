-- Fail-closed RLS hardening + app_rw privileges for the NEW fin schema (mirrors the
-- platform block in 0002 and the md/wh block in 0008). FORCE subjects even the table
-- owner to RLS (superuser still bypasses; that is the deliberate bootstrap/seed path).
-- Repeat ENABLE defensively (0011 already emits it).
ALTER TABLE "fin"."fiscal_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fin"."fiscal_periods" FORCE ROW LEVEL SECURITY;

-- app_rw runtime privileges (mirrors 0002 platform / 0008 md+wh).
GRANT USAGE ON SCHEMA "fin" TO "app_rw";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "fin" TO "app_rw";
ALTER DEFAULT PRIVILEGES IN SCHEMA "fin" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app_rw";

-- No overlapping periods per tenant (btree_gist enables the mixed =/&& exclusion).
-- drizzle-kit cannot express EXCLUDE constraints, hence this custom migration.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "fin"."fiscal_periods" ADD CONSTRAINT fiscal_periods_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&);
