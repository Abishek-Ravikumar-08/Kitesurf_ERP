import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { WorkerModule } from "./worker.module.js";

async function bootstrap() {
  const ctx = await NestFactory.createApplicationContext(WorkerModule);
  ctx.enableShutdownHooks();
}
bootstrap().catch((err) => {
  console.error("worker bootstrap failed:", err);
  process.exit(1);
});
