export abstract class DomainError extends Error {
  abstract readonly code: string;
}

/** An outbox event whose payload fails its registered contract schema. */
export class InvalidEventPayloadError extends DomainError {
  readonly code = "INVALID_EVENT_PAYLOAD";
  constructor(eventType: string, detail: string) {
    super(`invalid payload for event "${eventType}": ${detail}`);
    this.name = "InvalidEventPayloadError";
  }
}
