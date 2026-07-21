import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FiscalPeriodClosedV1, FiscalPeriodReopenedV1 } from "./fiscal.js";
import { EVENT_SCHEMAS } from "./registry.js";

describe("fiscal event contracts (v1)", () => {
  const valid = {
    FiscalPeriodClosed: { schema: FiscalPeriodClosedV1 },
    FiscalPeriodReopened: { schema: FiscalPeriodReopenedV1 },
  } as const;

  for (const [type, { schema }] of Object.entries(valid)) {
    const payload = { periodId: randomUUID(), year: 2026, period: 7 };

    it(`${type} v1 round-trips a valid payload`, () => {
      const parsed = schema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it(`${type} v1 rejects a non-integer year`, () => {
      expect(schema.safeParse({ ...payload, year: 2026.5 }).success).toBe(false);
    });

    it(`${type} v1 rejects a missing periodId`, () => {
      const { periodId: _periodId, ...withoutId } = payload;
      expect(schema.safeParse(withoutId).success).toBe(false);
    });

    it(`${type} v1 is registered in EVENT_SCHEMAS`, () => {
      expect(EVENT_SCHEMAS[type]?.[1]).toBe(schema);
    });
  }
});
