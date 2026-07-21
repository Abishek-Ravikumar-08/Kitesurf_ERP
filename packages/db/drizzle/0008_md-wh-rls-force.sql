-- Fail-closed RLS hardening + app_rw privileges for the md/wh schemas, plus the FK
-- constraints drizzle-kit could not emit (cross-file table imports break its loader, D-017).
-- FORCE subjects even the table owner to RLS (superuser still bypasses; that is the
-- deliberate bootstrap/seed path). Repeat ENABLE defensively.
ALTER TABLE "md"."materials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "md"."materials" FORCE ROW LEVEL SECURITY;
ALTER TABLE "wh"."stock_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wh"."stock_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "wh"."stock_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "wh"."stock_reservations" FORCE ROW LEVEL SECURITY;

-- FKs (see D-017 note above; schema files stay import-free of each other).
ALTER TABLE "wh"."stock_items" ADD CONSTRAINT "stock_items_material_fk" FOREIGN KEY ("material_id") REFERENCES "md"."materials"("id");
ALTER TABLE "wh"."stock_reservations" ADD CONSTRAINT "stock_reservations_stock_item_fk" FOREIGN KEY ("stock_item_id") REFERENCES "wh"."stock_items"("id");

-- app_rw runtime privileges (mirrors the platform-schema block in 0002).
GRANT USAGE ON SCHEMA "md" TO "app_rw";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "md" TO "app_rw";
ALTER DEFAULT PRIVILEGES IN SCHEMA "md" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app_rw";
GRANT USAGE ON SCHEMA "wh" TO "app_rw";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "wh" TO "app_rw";
ALTER DEFAULT PRIVILEGES IN SCHEMA "wh" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "app_rw";
