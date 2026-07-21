-- Fail-closed RLS hardening + app_rw runtime privileges.
-- FORCE subjects even the table owner to RLS (superuser still bypasses; that is the
-- deliberate bootstrap/migration/relay path). Repeat ENABLE defensively.
ALTER TABLE "platform"."tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."tenants" FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA "platform" TO "app_rw";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "platform" TO "app_rw";
ALTER DEFAULT PRIVILEGES IN SCHEMA "platform" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app_rw";
-- Defense in depth on top of RLS: tenant sessions never rewrite the tenant registry,
-- and only read the meta row (no app_rw code path writes it).
REVOKE UPDATE, DELETE ON "platform"."tenants" FROM "app_rw";
GRANT SELECT ON "platform_meta" TO "app_rw";
