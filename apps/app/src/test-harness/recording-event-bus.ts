import type { DomainEvent } from "../shared/events/domain-event.ts";
import type { DomainEventPublisher } from "../shared/ports/domain-event-publisher.port.ts";

/**
 * Bus ghi lại event cho test. `failWhen`: nếu có event trong lô thoả điều kiện thì `publish` ném lỗi
 * và không ghi gì (lô bị coi là chưa giao).
 */
export class RecordingEventBus implements DomainEventPublisher {
  readonly published: DomainEvent[] = [];
  failWhen: ((event: DomainEvent) => boolean) | null = null;

  publish(events: readonly DomainEvent[]): void {
    if (this.failWhen && events.some(this.failWhen)) throw new Error("RecordingEventBus: lỗi giả lập");
    this.published.push(...events);
  }

  reset(): void {
    this.published.length = 0;
    this.failWhen = null;
  }
}
