import type { z } from "zod";

/**
 * Event payload schemas by type → version. `appendOutbox` validates registered types at
 * write time. Starts EMPTY — Task 6 (and Phase 3 modules) register real event contracts.
 */
export const EVENT_SCHEMAS: Record<string, Record<number, z.ZodType>> = {};
