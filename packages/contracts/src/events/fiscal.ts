import { z } from "zod";

/** Emitted when a fiscal period is closed — postings gate shut for its date range. */
export const FiscalPeriodClosedV1 = z.object({
  periodId: z.uuid(),
  year: z.int(),
  period: z.int(),
});

/** Emitted when a closed fiscal period is reopened (late postings re-admitted). */
export const FiscalPeriodReopenedV1 = z.object({
  periodId: z.uuid(),
  year: z.int(),
  period: z.int(),
});
