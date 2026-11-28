import type { TrackingEvent } from "./tracking-events.ts";

/** Hợp mọi domain event của app; thêm event của context khác vào đây. */
export type DomainEvent = TrackingEvent;
export type DomainEventType = DomainEvent["type"];
