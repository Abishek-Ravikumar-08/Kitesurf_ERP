import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Point drizzle-kit at the concrete table file, NOT the barrel ./src/schema/index.ts:
  // drizzle-kit loads this config via esbuild-register (CJS) and can't resolve the barrel's
  // NodeNext ".js"->".ts" re-export. Add future table files here explicitly (array) — a bare
  // "./src/schema/*.ts" glob would re-include index.ts and hit the same resolution error.
  schema: ["./src/schema/platform.ts", "./src/schema/rls.ts", "./src/schema/tenancy.ts"],
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  // Emit CREATE ROLE for roles defined in the schema (app_rw).
  entities: { roles: true },
});
