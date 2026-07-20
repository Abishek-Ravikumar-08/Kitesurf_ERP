import { assertSchemaVersion, makeDb, schema } from "@erp/db";
import { type ConsumerRegistry, relayOutboxBatch, verifyAuditChain } from "@erp/platform";
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
// pg-boss 12 is pure ESM with a NAMED export — there is no default export.
import { PgBoss } from "pg-boss";
import { WORKER_CONFIG, type WorkerConfig } from "../config/env.js";
import { PROD_REGISTRY } from "../registry.js";

export const CHAIN_VERIFY_QUEUE = "audit-chain-verify";

@Injectable()
export class RelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(RelayService.name);
  private handle!: ReturnType<typeof makeDb>;
  private boss!: PgBoss;
  private timer?: NodeJS.Timeout;
  private draining = false;
  readonly registry: ConsumerRegistry = PROD_REGISTRY;

  constructor(@Inject(WORKER_CONFIG) private readonly cfg: WorkerConfig) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      this.handle = makeDb(this.cfg.DATABASE_URL);
      await assertSchemaVersion(this.handle.db); // boot gate: fail closed like the api
      this.boss = new PgBoss(this.cfg.DATABASE_URL);
      this.boss.on("error", (err) => this.log.error(err));
      await this.boss.start();
      for (const q of [CHAIN_VERIFY_QUEUE, ...this.registry.allQueues()]) {
        await this.boss.createQueue(q);
      }
      await this.boss.schedule(CHAIN_VERIFY_QUEUE, "0 3 * * *", {}, {});
      await this.boss.work(CHAIN_VERIFY_QUEUE, async () => this.verifyChains());
      this.timer = setInterval(() => void this.tick(), this.cfg.RELAY_INTERVAL_MS);
      this.log.log(`outbox relay every ${this.cfg.RELAY_INTERVAL_MS}ms`);
    } catch (err) {
      // A failed init never receives onApplicationShutdown — release whatever we grabbed
      // (else the boot-gate test leaks a live pool that explodes when the container stops,
      // and a crash-looping prod worker leaks one connection per attempt), then rethrow.
      await this.boss?.stop().catch(() => {});
      await this.handle?.pool.end().catch(() => {});
      throw err;
    }
  }

  /** Reentrancy-guarded drain tick. */
  async tick(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      let n: number;
      do {
        n = await relayOutboxBatch(this.handle.db, this.boss, this.registry);
      } while (n > 0);
    } catch (err) {
      this.log.error(err);
    } finally {
      this.draining = false;
    }
  }

  private async verifyChains(): Promise<void> {
    const heads = await this.handle.db.select().from(schema.auditHead);
    for (const h of heads) {
      const v = await verifyAuditChain(this.handle.db, {
        tenantId: h.tenantId,
        aggregateType: h.aggregateType,
        aggregateId: h.aggregateId,
      });
      if (!v.valid) {
        this.log.error(
          `AUDIT CHAIN BROKEN ${h.aggregateType}/${h.aggregateId}: ${JSON.stringify(v)}`,
        );
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.boss?.stop();
    await this.handle?.pool.end();
  }
}
