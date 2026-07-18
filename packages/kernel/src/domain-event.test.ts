import { describe, expect, it } from "vitest";
import { createEvent } from "./domain-event.js";
import { asTenantId, asUserId, newId } from "./id.js";

describe("createEvent", () => {
  it("builds the canonical envelope with correlation defaults", () => {
    const now = new Date("2026-07-16T00:00:00.000Z");
    const e = createEvent({
      type: "SalesOrderConfirmed",
      eventVersion: 1,
      tenantId: asTenantId(newId()),
      actor: asUserId(newId()),
      payload: { orderId: "so-1" },
      occurredAt: now,
    });
    expect(e.eventId).toMatch(/-7[0-9a-f]{3}-/);
    expect(e.type).toBe("SalesOrderConfirmed");
    expect(e.eventVersion).toBe(1);
    expect(e.occurredAt).toBe(now.toISOString());
    // correlationId defaults to eventId; causationId defaults to undefined
    expect(e.correlationId).toBe(e.eventId);
    expect(e.causationId).toBeUndefined();
    expect(e.payload).toEqual({ orderId: "so-1" });
  });

  it("uses caller-supplied correlationId and causationId when provided", () => {
    const now = new Date("2026-07-16T00:00:00.000Z");
    const e = createEvent({
      type: "SalesOrderConfirmed",
      eventVersion: 1,
      tenantId: asTenantId(newId()),
      actor: asUserId(newId()),
      payload: { orderId: "so-1" },
      occurredAt: now,
      correlationId: "corr-1",
      causationId: "cause-1",
    });
    expect(e.correlationId).toBe("corr-1");
    expect(e.causationId).toBe("cause-1");
  });

  it("accepts a null actor for system-originated events", () => {
    const now = new Date("2026-07-16T00:00:00.000Z");
    const e = createEvent({
      type: "OutboxRelayed",
      eventVersion: 1,
      tenantId: asTenantId(newId()),
      actor: null,
      payload: {},
      occurredAt: now,
    });
    expect(e.actor).toBeNull();
  });
});
