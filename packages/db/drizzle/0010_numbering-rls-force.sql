-- Fail-closed RLS hardening for the numbering tables. FORCE subjects even the table
-- owner to RLS (superuser still bypasses; that is the deliberate bootstrap/seed path).
-- Repeat ENABLE defensively (0009 already emits it).
-- NOTE: no GRANT block here — app_rw privileges on new md tables arrive automatically
-- via the ALTER DEFAULT PRIVILEGES IN SCHEMA "md" set up in 0008.
ALTER TABLE "md"."number_ranges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "md"."number_ranges" FORCE ROW LEVEL SECURITY;
ALTER TABLE "md"."number_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "md"."number_allocations" FORCE ROW LEVEL SECURITY;
