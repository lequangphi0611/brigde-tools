import type { DomainEvent } from "../events/domain-event.ts";

/**
 * Port: phát domain event (ADR-0011). Đồng bộ; handler chạy ngay trong lời gọi, nên bên phát gọi trong
 * `UnitOfWork.run` của mình. Handler ném lỗi thì `publish` ném lỗi (bên phát rollback).
 */
export interface DomainEventPublisher {
  publish(events: readonly DomainEvent[]): void;
}
