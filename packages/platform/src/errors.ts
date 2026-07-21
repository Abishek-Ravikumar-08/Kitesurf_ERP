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

/** An optimistic-lock failure: the row's version moved past the caller's expected version. */
export class VersionConflictError extends DomainError {
  readonly code = "VERSION_CONFLICT";
  constructor(
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(`version conflict: expected ${expected}, actual ${actual}`);
    this.name = "VersionConflictError";
  }
}

/** An allocation against a number range that was never created (or is out of tenant). */
export class NumberRangeNotFoundError extends DomainError {
  readonly code = "NUMBER_RANGE_NOT_FOUND";
  constructor(rangeKey: string, period: string) {
    super(`number range ${rangeKey} (period ${JSON.stringify(period)}) not found`);
    this.name = "NumberRangeNotFoundError";
  }
}

/** A close/reopen against a fiscal period that does not exist (or is out of tenant). */
export class FiscalPeriodNotFoundError extends DomainError {
  readonly code = "FISCAL_PERIOD_NOT_FOUND";
  constructor(periodId: string) {
    super(`fiscal period ${periodId} not found`);
    this.name = "FiscalPeriodNotFoundError";
  }
}

/** A posting date covered by NO fiscal period — the gate fails closed. */
export class FiscalPeriodNotOpenError extends DomainError {
  readonly code = "FISCAL_PERIOD_NOT_OPEN";
  constructor(postingDate: string) {
    super(`no fiscal period covers posting date ${postingDate}`);
    this.name = "FiscalPeriodNotOpenError";
  }
}

/** A posting into (or a re-close of) a fiscal period that is closed. */
export class FiscalPeriodClosedError extends DomainError {
  readonly code = "FISCAL_PERIOD_CLOSED";
  constructor(ref: string) {
    super(`fiscal period is closed: ${ref}`);
    this.name = "FiscalPeriodClosedError";
  }
}

/** A reopen against a fiscal period that is not closed (already open). */
export class FiscalPeriodNotClosedError extends DomainError {
  readonly code = "FISCAL_PERIOD_NOT_CLOSED";
  constructor(periodId: string) {
    super(`fiscal period ${periodId} is not closed`);
    this.name = "FiscalPeriodNotClosedError";
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
