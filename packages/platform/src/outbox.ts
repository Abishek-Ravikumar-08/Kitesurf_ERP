import { EVENT_SCHEMAS } from "@erp/contracts";
import { type Tx, schema } from "@erp/db";
import type { DomainEvent } from "@erp/kernel";
import { InvalidEventPayloadError } from "./errors.js";

/** Persist a domain event in the SAME transaction as the business write + audit row. */
export async function appendOutbox(tx: Tx, event: DomainEvent): Promise<void> {
  // Unregistered event types skip validation (lets tests use ad-hoc types).
  // TODO(Phase 3): strict / warn-on-unregistered once real consumers exist —
  // a typo'd production event type must not silently bypass validation forever.
  const versions = EVENT_SCHEMAS[event.type];
  const eventSchema = versions?.[event.eventVersion];
  if (eventSchema) {
    const parsed = eventSchema.safeParse(event.payload);
    if (!parsed.success) throw new InvalidEventPayloadError(event.type, parsed.error.message);
  }
  await tx.insert(schema.outbox).values({
    id: event.eventId,
    tenantId: event.tenantId,
    type: event.type,
    eventVersion: event.eventVersion,
    occurredAt: new Date(event.occurredAt),
    actor: event.actor,
    correlationId: event.correlationId,
    causationId: event.causationId ?? null,
    payload: event.payload,
  });
}
