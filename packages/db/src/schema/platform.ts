import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Single-row table recording the schema version the DB is migrated to.
export const platformMeta = pgTable("platform_meta", {
  id: integer("id").primaryKey().default(1),
  schemaVersion: integer("schema_version").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});
