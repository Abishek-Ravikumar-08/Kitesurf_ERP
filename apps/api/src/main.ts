import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { loadConfig } from "./config/env.js";

async function bootstrap() {
  const cfg = loadConfig(); // fail-fast at boot
  const app = await NestFactory.create(AppModule);
  await app.listen(cfg.PORT);
}
void bootstrap();
