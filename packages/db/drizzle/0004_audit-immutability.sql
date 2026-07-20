ALTER TABLE "platform"."audit_head" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."audit_head" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform"."audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."audit_log" FORCE ROW LEVEL SECURITY;

-- Immutability: nobody updates/deletes/truncates audit rows — not even the owner.
REVOKE UPDATE, DELETE, TRUNCATE ON "platform"."audit_log" FROM PUBLIC, "app_rw";
CREATE OR REPLACE FUNCTION platform.audit_log_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'platform.audit_log is append-only (% blocked)', TG_OP;
END $$;
CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "platform"."audit_log"
  FOR EACH ROW EXECUTE FUNCTION platform.audit_log_immutable();
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "platform"."audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION platform.audit_log_immutable();
