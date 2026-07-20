import type { z } from "zod";
import {
  StockAdjustedV1,
  StockReservationConsumedV1,
  StockReservationReleasedV1,
  StockReservedV1,
} from "./stock.js";

/**
 * Event payload schemas by type → version. `appendOutbox` validates registered types at
 * write time.
 */
export const EVENT_SCHEMAS: Record<string, Record<number, z.ZodType>> = {
  StockReserved: { 1: StockReservedV1 },
  StockReservationReleased: { 1: StockReservationReleasedV1 },
  StockReservationConsumed: { 1: StockReservationConsumedV1 },
  StockAdjusted: { 1: StockAdjustedV1 },
};
