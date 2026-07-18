import { type EventId, type TenantId, type UserId, asEventId, newId } from "./id.js";

export interface DomainEvent<TType extends string = string, TPayload = unknown> {
  eventId: EventId;
  type: TType;
  eventVersion: number;
  occurredAt: string; // ISO-8601
  tenantId: TenantId;
  actor: UserId | null;
  correlationId: string;
  causationId?: string;
  payload: TPayload;
}

export interface CreateEventInput<TType extends string, TPayload> {
  type: TType;
  eventVersion: number;
  tenantId: TenantId;
  actor: UserId | null;
  payload: TPayload;
  occurredAt: Date; // caller supplies the clock (testable/deterministic)
  correlationId?: string;
  causationId?: string;
}

export function createEvent<TType extends string, TPayload>(
  input: CreateEventInput<TType, TPayload>,
): DomainEvent<TType, TPayload> {
  const eventId = asEventId(newId());
  return {
    eventId,
    type: input.type,
    eventVersion: input.eventVersion,
    occurredAt: input.occurredAt.toISOString(),
    tenantId: input.tenantId,
    actor: input.actor,
    correlationId: input.correlationId ?? eventId,
    ...(input.causationId !== undefined ? { causationId: input.causationId } : {}),
    payload: input.payload,
  };
}
