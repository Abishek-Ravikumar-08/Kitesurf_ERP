import { z } from "zod";

/** All quantities travel as decimal STRINGS (spec §6) — never floats. */
const qty = z.string().regex(/^-?\d+(\.\d+)?$/);

export const StockReservedV1 = z.object({
  stockItemId: z.uuid(),
  materialId: z.uuid(),
  qty,
  kind: z.enum(["soft", "hard"]),
  ref: z.string().nullable(),
});

export const StockReservationReleasedV1 = z.object({
  reservationId: z.uuid(),
  stockItemId: z.uuid(),
  qty,
});

export const StockReservationConsumedV1 = z.object({
  reservationId: z.uuid(),
  stockItemId: z.uuid(),
  qty,
});

export const StockAdjustedV1 = z.object({
  stockItemId: z.uuid(),
  delta: qty,
  reason: z.string(),
  postingDate: z.string(), // YYYY-MM-DD; fiscal-period gate arrives in Task 9
});
