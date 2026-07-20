export abstract class DomainError extends Error {
  abstract readonly code: string;
}

/** A quantity/delta string that is not a well-formed decimal (or violates the sign rule). */
export class InvalidQuantityError extends DomainError {
  readonly code = "INVALID_QUANTITY";
  constructor(qty: string) {
    super(`invalid quantity: ${JSON.stringify(qty)}`);
    this.name = "InvalidQuantityError";
  }
}

/** A reserve/adjust that would violate the item's negative-stock policy. */
export class InsufficientStockError extends DomainError {
  readonly code = "INSUFFICIENT_STOCK";
  constructor(stockItemId: string, qty: string) {
    super(`insufficient stock on item ${stockItemId} for qty ${qty}`);
    this.name = "InsufficientStockError";
  }
}

/** A release/consume against a reservation that is not (or no longer) active. */
export class ReservationNotActiveError extends DomainError {
  readonly code = "RESERVATION_NOT_ACTIVE";
  constructor(reservationId: string) {
    super(`reservation ${reservationId} is not active`);
    this.name = "ReservationNotActiveError";
  }
}

/** A stock operation against a non-existent (or out-of-tenant) stock item. */
export class StockItemNotFoundError extends DomainError {
  readonly code = "STOCK_ITEM_NOT_FOUND";
  constructor(stockItemId: string) {
    super(`stock item ${stockItemId} not found`);
    this.name = "StockItemNotFoundError";
  }
}

/** An outbox event whose payload fails its registered contract schema. */
export class InvalidEventPayloadError extends DomainError {
  readonly code = "INVALID_EVENT_PAYLOAD";
  constructor(eventType: string, detail: string) {
    super(`invalid payload for event "${eventType}": ${detail}`);
    this.name = "InvalidEventPayloadError";
  }
}
