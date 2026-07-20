ALTER TABLE "platform"."outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."outbox" FORCE ROW LEVEL SECURITY;
ALTER TABLE "platform"."event_archive" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "platform"."event_archive" FORCE ROW LEVEL SECURITY;
-- App sessions APPEND and read the outbox; only the (superuser) relay marks/deletes.
REVOKE UPDATE, DELETE, TRUNCATE ON "platform"."outbox" FROM "app_rw";
-- The archive is never pruned (spec §9.2) and written only by the relay.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "platform"."event_archive" FROM "app_rw";
