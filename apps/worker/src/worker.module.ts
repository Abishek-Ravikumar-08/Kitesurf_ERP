import { Module } from "@nestjs/common";
import { WORKER_CONFIG, loadConfig } from "./config/env.js";
import { RelayService } from "./relay/relay.service.js";

@Module({
  providers: [{ provide: WORKER_CONFIG, useFactory: () => loadConfig() }, RelayService],
})
export class WorkerModule {}
