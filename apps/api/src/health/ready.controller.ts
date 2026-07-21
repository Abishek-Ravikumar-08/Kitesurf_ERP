import { assertSchemaVersion, ping } from "@erp/db";
import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { DB, type DbHandle } from "../db/db.module.js";

@Controller()
export class ReadyController {
  constructor(@Inject(DB) private readonly handle: DbHandle) {}

  @Get("ready")
  async ready(): Promise<{ status: "ready" }> {
    try {
      await ping(this.handle.db);
      await assertSchemaVersion(this.handle.db);
      return { status: "ready" };
    } catch (err) {
      throw new ServiceUnavailableException({
        status: "unready",
        reason: (err as Error).message,
      });
    }
  }
}
