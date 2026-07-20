import { makeDb } from "@erp/db";
import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { APP_CONFIG } from "../config/config.module.js";
import type { AppConfig } from "../config/env.js";

export const DB = Symbol("DB");
export type DbHandle = ReturnType<typeof makeDb>;

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (cfg: AppConfig): DbHandle => makeDb(cfg.DATABASE_URL),
      inject: [APP_CONFIG],
    },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}
  async onApplicationShutdown(): Promise<void> {
    await this.handle.pool.end();
  }
}
