import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  RELAY_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
});

export type WorkerConfig = z.infer<typeof EnvSchema>;

/** DI token lives HERE (a leaf module) — not in worker.module.ts — so relay.service.ts
 * never imports the module back (circular ESM imports leave the token in TDZ at
 * decorator-evaluation time). */
export const WORKER_CONFIG = Symbol("WORKER_CONFIG");

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid worker configuration: ${issues}`);
  }
  return parsed.data;
}
