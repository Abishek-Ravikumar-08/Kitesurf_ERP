import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EVENT_SCHEMAS } from "./registry.js";
import {
  StockAdjustedV1,
  StockReservationConsumedV1,
  StockReservationReleasedV1,
  StockReservedV1,
} from "./stock.js";

const uuid = () => randomUUID();

describe("stock event contracts (v1)", () => {
  const valid = {
    StockReserved: {
      schema: StockReservedV1,
      payload: { stockItemId: uuid(), materialId: uuid(), qty: "30", kind: "hard", ref: null },
    },
    StockReservationReleased: {
      schema: StockReservationReleasedV1,
      payload: { reservationId: uuid(), stockItemId: uuid(), qty: "12.5" },
    },
    StockReservationConsumed: {
      schema: StockReservationConsumedV1,
      payload: { reservationId: uuid(), stockItemId: uuid(), qty: "0.000001" },
    },
    StockAdjusted: {
      schema: StockAdjustedV1,
      payload: {
        stockItemId: uuid(),
        delta: "-5",
        reason: "cycle count",
        postingDate: "2026-07-20",
      },
    },
  } as const;

  for (const [type, { schema, payload }] of Object.entries(valid)) {
    it(`${type} v1 round-trips a valid payload`, () => {
      const parsed = schema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it(`${type} v1 rejects a float-typed qty`, () => {
      const qtyField = "delta" in payload ? "delta" : "qty";
      const bad = { ...payload, [qtyField]: 1.5 };
      expect(schema.safeParse(bad).success).toBe(false);
    });

    it(`${type} v1 is registered in EVENT_SCHEMAS`, () => {
      expect(EVENT_SCHEMAS[type]?.[1]).toBe(schema);
    });
  }
});
