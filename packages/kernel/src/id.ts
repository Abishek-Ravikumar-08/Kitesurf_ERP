import { v7 as uuidv7 } from "uuid";

/** Opaque branded-id helper — compile-time safety, runtime is just a string. */
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TenantId = Brand<string, "TenantId">;
export type UserId = Brand<string, "UserId">;
export type EventId = Brand<string, "EventId">;

export const newId = (): string => uuidv7();
export const asTenantId = (s: string): TenantId => s as TenantId;
export const asUserId = (s: string): UserId => s as UserId;
export const asEventId = (s: string): EventId => s as EventId;
