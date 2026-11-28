import type { DomainEvent, DomainEventType } from "../../events/domain-event.ts";
import type { DomainEventPublisher } from "../../ports/domain-event-publisher.port.ts";

export type EventHandler<T extends DomainEventType = DomainEventType> = (event: Extract<DomainEvent, { type: T }>) => void;

/**
 * Bus trong process (ADR-0011): handler đăng ký theo `type`, gọi tuần tự theo thứ tự đăng ký, theo thứ tự event.
 * Handler ném lỗi thì dừng và ném lại (không nuốt); handler phải đồng bộ và chỉ ghi DB.
 */
export class InProcessEventBus implements DomainEventPublisher {
  private readonly handlers = new Map<DomainEventType, Array<(event: DomainEvent) => void>>();

  subscribe<T extends DomainEventType>(type: T, handler: EventHandler<T>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler as unknown as (event: DomainEvent) => void);
    this.handlers.set(type, list);
  }

  publish(events: readonly DomainEvent[]): void {
    for (const event of events) {
      for (const handler of this.handlers.get(event.type) ?? []) handler(event);
    }
  }
}
