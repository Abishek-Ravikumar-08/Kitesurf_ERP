import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { ReadyController } from "./ready.controller.js";

@Module({ controllers: [HealthController, ReadyController] })
export class HealthModule {}
